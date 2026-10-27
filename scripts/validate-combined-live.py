#!/usr/bin/env python3
"""Validate saved PDFs from the six-page combined large-image/link Figma fixture.

Requires Python 3 and pypdf. The fixture is documented in
'docs/large-links-live-fixture.json': six 3840x2880 pages, three web targets
(one wrapped), next/previous text links, and a rectangular prototype hotspot.

Examples:
  python3 scripts/validate-combined-live.py --mode vector -- vector.pdf
  python3 scripts/validate-combined-live.py --mode raster \
    --oracle-kind vector --oracle vector.pdf -- jpeg.pdf
  python3 scripts/validate-combined-live.py --mode cmyk \
    --oracle-kind vector --oracle vector.pdf -- part1.pdf part2.pdf part3.pdf

Supply PDFs in export order and keep original part filenames so remote links
can be verified. Use --frame-ids only when native oracle PDFs contain Figma
node URLs. Indices in JSON reports are zero-based. --oracle-kind vector
records that the reference is a plugin export, not an independent native PDF.
This checks PDF structure and annotation geometry, not rendered appearance.
"""
import argparse, hashlib, json, math
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from pypdf import PdfReader
from pypdf.generic import ContentStream

ROOT = Path(__file__).resolve().parents[1]
if not __debug__:
    raise SystemExit('Run this validator without Python -O; its checks use assertions.')

parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
parser.add_argument('--mode', required=True, choices=['vector', 'raster', 'cmyk'])
parser.add_argument('--frame-ids', nargs=6, help='Six Figma frame IDs in exported page order, for native NODE URI matching.')
parser.add_argument('--oracle', nargs='+', default=[], help='Ordered reference PDFs for exact text-link rectangle comparison. End this list with -- before output PDFs.')
parser.add_argument('--oracle-kind', choices=['native','vector'], default='native')
parser.add_argument('--icc', default=str(ROOT/'assets/color-profiles/ISOcoated_v2_300_bas.ICC'))
parser.add_argument('--prefix', default='https://example.com/combined')
parser.add_argument('--output', help='Write the detailed JSON inspection report to this path.')
parser.add_argument('--tolerance', type=float, default=0.01)
parser.add_argument('files', nargs='+')
args = parser.parse_args()
TOL = args.tolerance
assert math.isfinite(TOL) and 0 < TOL <= 0.1
FRAME_IDS = {value:i for i,value in enumerate(args.frame_ids or [])}
PROFILE = Path(args.icc).read_bytes() if args.mode == 'cmyk' else None
PROTOTYPE_RECT = [100, 360, 400, 480]

def close_numbers(a,b):
    return len(a)==len(b) and all(abs(float(x)-float(y))<=TOL for x,y in zip(a,b))

def frame_target(uri):
    parsed=urlparse(uri)
    if parsed.hostname not in ['figma.com','www.figma.com'] or not parsed.path.startswith(('/design/','/file/')): return None
    values=parse_qs(parsed.query).get('node-id',[])
    return FRAME_IDS.get(values[0].replace('-',':')) if len(values)==1 else None

def inspect(paths, oracle=False):
    specs=[]; start=0
    for path in paths:
        path=Path(path)
        with path.open('rb') as stream: count=len(PdfReader(stream).pages)
        specs.append({'path':path,'file':path.name,'start':start,'count':count});start+=count
    assert start==6, f'Expected six pages, got {start}'
    assert len({s['file'] for s in specs})==len(specs), 'Part basenames must be unique'
    by_name={s['file']:s for s in specs}; pages=[]
    for spec in specs:
        with spec['path'].open('rb') as stream:
            reader=PdfReader(stream)
            refs={(p.indirect_reference.idnum,p.indirect_reference.generation):i for i,p in enumerate(reader.pages)}
            for local_index,page in enumerate(reader.pages):
                index=spec['start']+local_index
                dimensions=[float(page.mediabox.width),float(page.mediabox.height)]
                assert close_numbers(dimensions,[3840,2880]), f'Page {index}: dimensions {dimensions}'
                assert close_numbers(list(page.mediabox),[0,0,3840,2880]), f'Page {index}: offset MediaBox'
                assert close_numbers(list(page.cropbox),[0,0,3840,2880]), f'Page {index}: offset CropBox'
                assert int(page.get('/Rotate',0))%360==0, f'Page {index}: unexpected rotation'
                links=[]
                for item in page.get('/Annots',[]):
                    ann=item.get_object()
                    if ann.get('/Subtype')!='/Link': continue
                    rect=list(map(float,ann['/Rect']))
                    assert len(rect)==4 and all(math.isfinite(v) for v in rect)
                    assert -TOL<=rect[0]<rect[2]<=3840+TOL and -TOL<=rect[1]<rect[3]<=2880+TOL, f'Page {index}: out-of-page annotation {rect}'
                    action=ann.get('/A');action=action.get_object() if action is not None else {};dest=ann.get('/Dest')
                    record={'rect':rect}
                    if action.get('/S')=='/URI':
                        uri=str(action['/URI']);target=frame_target(uri)
                        if target is not None: record.update(kind='internal',targetPage=target,transport='native-uri')
                        elif oracle and not uri:record.update(kind='unknown-internal')
                        else:record.update(kind='external',uri=uri)
                    elif action.get('/S')=='/GoToR':
                        name=action['/F'].get_object()
                        if isinstance(name,dict):name=name.get('/UF',name.get('/F'))
                        name=str(name);remote=action['/D'].get_object();target_spec=by_name.get(name)
                        assert target_spec is not None, f'Page {index}: remote filename does not match supplied parts: {name}'
                        target=int(remote[0]);assert float(remote[0])==target and 0<=target<target_spec['count'] and str(remote[1])=='/Fit'
                        assert name!=spec['file'], f'Page {index}: same-part link unnecessarily remote'
                        record.update(kind='internal',targetPage=target_spec['start']+target,transport='remote',file=name,localPage=target)
                    else:
                        if action.get('/S')=='/GoTo':dest=action.get('/D')
                        assert dest is not None, f'Page {index}: unsupported link action {action}'
                        dest=dest.get_object();ref=dest[0]
                        assert hasattr(ref,'idnum') and (ref.idnum,ref.generation) in refs, f'Page {index}: invalid local destination'
                        assert str(dest[1])=='/Fit'
                        record.update(kind='internal',targetPage=spec['start']+refs[(ref.idnum,ref.generation)],transport='local')
                    # Repeated rectangles must not masquerade as wrapped text
                    # fragments, even when no reference PDF is available.
                    target_key=(record['kind'],record.get('uri'),record.get('targetPage'))
                    for previous in links:
                        previous_key=(previous['kind'],previous.get('uri'),previous.get('targetPage'))
                        assert target_key!=previous_key or not close_numbers(rect,previous['rect']), f'Page {index}: duplicate link annotation {record}'
                    links.append(record)
                info={'page':index,'file':spec['file'],'localPage':local_index,'dimensions':dimensions,'links':links}
                if not oracle:
                    expected={f'{args.prefix}/{index+1}/{suffix}' for suffix in ['web','docs','wrapped']}
                    external=[l for l in links if l['kind']=='external']
                    assert {l['uri'] for l in external}==expected, f'Page {index}: wrong external targets: {[l["uri"] for l in external]}'
                    for suffix in ['web','docs']:
                        assert sum(l['uri']==f'{args.prefix}/{index+1}/{suffix}' for l in external)==1, f'Page {index}: duplicate or wrapped {suffix} link'
                    assert sum(l['uri'].endswith('/wrapped') for l in external)>=2, f'Page {index}: wrapped link needs multiple fragments'
                    proto=[l for l in links if close_numbers(l['rect'],PROTOTYPE_RECT)]
                    assert len(proto)==1 and proto[0].get('targetPage')==(index+1)%6, f'Page {index}: prototype rectangle/destination mismatch'
                    internal=[l for l in links if l['kind']=='internal' and l is not proto[0]]
                    assert len(internal)==2 and {l['targetPage'] for l in internal}=={(index+1)%6,(index-1)%6}, f'Page {index}: missing/wrong next or previous text destination'
                    for link in links:
                        if link['kind']=='internal':
                            in_part=spec['start']<=link['targetPage']<spec['start']+spec['count']
                            assert link['transport']==('local' if in_part else 'remote'), f'Page {index}: output retained a native URI or wrong destination transport'
                    resources=page.get('/Resources');resources=resources.get_object() if resources is not None else {};images=[]
                    objects=resources.get('/XObject');objects=objects.get_object() if objects is not None else {}
                    for image in objects.values():
                        image=image.get_object()
                        if image.get('/Subtype')=='/Image':images.append(image)
                    info['imageCount']=len(images)
                    ops=ContentStream(page.get_contents(),reader).operations
                    info['pathPaints']=sum(op in [b'f',b'f*',b'S',b's',b'B',b'B*',b'b',b'b*'] for _,op in ops)
                    info['textOperators']=sum(op in [b'Tj',b'TJ',b"'",b'"'] for _,op in ops)
                    if args.mode=='vector':assert info['pathPaints'] or info['textOperators'], f'Page {index}: no preserved vector/text operators'
                    else:
                        assert len(images)==1, f'Page {index}: raster output should have one page image'
                        image=images[0];w,h=int(image['/Width']),int(image['/Height']);info['pixels']=[w,h]
                        assert w>0 and h>0 and abs(w/h-3840/2880)<0.002, f'Page {index}: image aspect ratio changed'
                        if args.mode=='cmyk':
                            assert w*h<=8000000 and max(w,h)<=16384
                            assert image.get('/BitsPerComponent')==8 and image.get('/SMask') is None
                            cs=image['/ColorSpace'].get_object();assert cs[0]=='/ICCBased'
                            profile=cs[1].get_object();assert profile['/N']==4 and profile.get_data()==PROFILE
                            assert len(image.get_data())==w*h*4, f'Page {index}: invalid four-channel pixel length'
                            info['profileSHA256']=hashlib.sha256(PROFILE).hexdigest()
                pages.append(info)
    return pages

def compare_oracle(actual, expected):
    limitations=[]
    for a,e in zip(actual,expected):
        remaining=[dict(l) for l in a['links'] if not close_numbers(l['rect'],PROTOTYPE_RECT)]
        # Native Figma does not export prototype actions; a plugin-produced oracle may.
        oracle_links=[l for l in e['links'] if not close_numbers(l['rect'],PROTOTYPE_RECT)]
        for old in oracle_links:
            candidates=[i for i,new in enumerate(remaining) if close_numbers(new['rect'],old['rect']) and
                (old['kind']=='unknown-internal' and new['kind']=='internal' or old['kind']==new['kind'] and
                 (new.get('uri')==old.get('uri') if old['kind']=='external' else new.get('targetPage')==old.get('targetPage')))]
            assert candidates, f'Page {a["page"]}: missing exact oracle annotation {old}'
            remaining.pop(candidates[0])
            if old['kind']=='unknown-internal': limitations.append('Native oracle contains empty NODE URIs: internal rectangles match, but this oracle cannot identify which label targets which page.')
        assert not remaining, f'Page {a["page"]}: output has extra text annotations {remaining}'
    return sorted(set(limitations))

try:
    actual=inspect(args.files)
    limitations=compare_oracle(actual,inspect(args.oracle,oracle=True)) if args.oracle else ['No native annotation oracle was supplied; exact text rectangles were not compared.']
    if args.oracle and args.oracle_kind=='vector':limitations.append('Annotation rectangles were compared to the plugin vector export, not an independently captured native source PDF.')
    summary={'status':'passed','mode':args.mode,'pages':actual,'files':[str(Path(x).resolve()) for x in args.files],
             'exactOracleRectangles':bool(args.oracle),'oracleKind':args.oracle_kind if args.oracle else None,'tolerance':TOL,'limitations':limitations}
    if args.output:Path(args.output).write_text(json.dumps(summary,indent=2)+'\n')
    print(json.dumps({'status':'passed','mode':args.mode,'pages':len(actual),'files':len(args.files),'annotations':sum(len(p['links']) for p in actual),'exactOracleRectangles':bool(args.oracle),'limitations':limitations}))
except Exception as error:
    print(json.dumps({'status':'failed','error':str(error)}))
    raise
