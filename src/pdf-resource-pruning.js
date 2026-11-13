// Remove only XObject names proven unused by a single native page. Analysis is
// complete before any mutation; unknown drawing constructs keep the page intact.
function createPdfResourcePruner(P, options = {}) {
  const { PDFName: Name, PDFNumber: Num, PDFArray: Arr, PDFDict: Dict, PDFRawStream: Stream, PDFRef: Ref, PDFNull } = P;
  const n = Name.of;
  const yieldToBrowser = options.yieldToBrowser || (() => new Promise(resolve => setTimeout(resolve, 0)));
  const MAX_CONTENT = 16 * 1024 * 1024, MAX_ENCODED = 64 * 1024 * 1024;
  const MAX_OBJECTS = 100000, MAX_INSTRUCTIONS = 500000, MAX_DEPTH = 32;
  const operators = new Set('q Q cm w J j M d ri i m l c v y h re S s f F f* B B* b b* n W W* BT ET Tc Tw Tz TL Tf Tr Ts Td TD Tm T* Tj TJ \' " d0 d1 MP DP BMC BDC EMC BX EX Do sh gs CS cs SC SCN sc scn G g RG rg K k'.split(' '));
  const fail = reason => { throw new Error(reason); };

  async function prunePage(doc, page, { stillActive = () => true } = {}) {
    const stats = { resourceDictionaries: 0, removedEntries: 0, removedEncodedBytes: 0, skipped: false };
    const active = () => { if (!stillActive()) throw new Error('PDF resource pruning was cancelled.'); };
    const context = doc.context;
    const lookup = value => value instanceof Ref ? context.lookup(value) : value;
    const dictionary = value => { value = lookup(value); if (!(value instanceof Dict)) fail('unsupported resource dictionaries'); return value; };
    const numeric = value => { value = lookup(value); if (!(value instanceof Num) || !Number.isFinite(value.asNumber())) fail('invalid numeric data'); return value.asNumber(); };
    const resourcesSeen = new Set(), usedByObjects = new Map(), opaque = new Set();
    const parsed = new Map(), visited = new Map(), visiting = new Map();
    let contentBytes = 0, executed = 0, visits = 0;
    const ensureBudget = depth => { if (depth > MAX_DEPTH || ++visits > MAX_OBJECTS) fail('excessive or deeply nested resources'); };

    // Unknown metadata is preserved. If it refers back to a resource dictionary,
    // that dictionary must not be changed based only on ordinary drawing uses.
    function protect(value, depth = 0) {
      value = lookup(value);
      if (!value || opaque.has(value)) return;
      ensureBudget(depth); opaque.add(value);
      if (value instanceof Stream) protect(value.dict, depth + 1);
      else if (value instanceof Dict) for (const child of value.values()) protect(child, depth + 1);
      else if (value instanceof Arr) for (const child of value.asArray()) protect(child, depth + 1);
    }

    function operations(stream) {
      stream = lookup(stream);
      if (parsed.has(stream)) return parsed.get(stream);
      if (!(stream instanceof Stream) || stream.contents.length > MAX_ENCODED) fail('unsupported or oversized drawing streams');
      let filter = stream.dict.lookup(n('Filter')), params = stream.dict.lookup(n('DecodeParms'));
      if (filter instanceof Arr && filter.size() === 1) filter = filter.lookup(0);
      if (params instanceof Arr && params.size() === 1) params = params.lookup(0);
      if (params && params !== PDFNull && (!(params instanceof Dict) || (params.has(n('Predictor')) && numeric(params.get(n('Predictor'))) !== 1))) fail('unsupported drawing-stream parameters');
      let bytes = stream.contents;
      if (filter && filter !== PDFNull) {
        if (filter.toString() !== '/FlateDecode') fail('unsupported drawing-stream encoding');
        if (bytes.length < 6 || (bytes[0] & 15) !== 8 || (bytes[0] >> 4) > 7 || ((bytes[0] << 8) + bytes[1]) % 31 || (bytes[1] & 32)) fail('invalid compressed drawing data');
        const decoder = P.decodePDFRawStream(stream), ensure = decoder.ensureBuffer;
        if (typeof ensure !== 'function') fail('unavailable bounded stream decoder');
        decoder.ensureBuffer = function (requested) {
          if (requested > MAX_CONTENT - contentBytes) fail('drawing data exceeds the analysis limit');
          return ensure.call(this, requested);
        };
        bytes = decoder.decode();
        let a = 1, b = 0;
        for (const byte of bytes) { a = (a + byte) % 65521; b = (b + a) % 65521; }
        const encoded = stream.contents;
        const checksum = new DataView(encoded.buffer, encoded.byteOffset + encoded.length - 4, 4).getUint32(0);
        if ((((b << 16) | a) >>> 0) !== checksum) fail('invalid drawing-stream checksum');
      }
      contentBytes += bytes.length;
      if (contentBytes > MAX_CONTENT) fail('drawing data exceeds the analysis limit');
      const parser = P.PDFObjectParser.forBytes(bytes, context), input = parser.bytes, result = [], args = [];
      while (!input.done()) {
        parser.skipWhitespaceAndComments(); if (input.done()) break;
        const byte = input.peek();
        if ([43, 45, 46].includes(byte) || (byte >= 48 && byte <= 57)) {
          let token = '';
          while (!input.done() && /[+\-0-9.]/.test(String.fromCharCode(input.peek()))) token += String.fromCharCode(input.next());
          if (!/^[+\-]?(?:\d+\.?\d*|\.\d+)$/.test(token) || !Number.isFinite(Number(token))) fail('invalid drawing operands');
          args.push(Num.of(Number(token)));
        } else if ([47, 40, 60, 91].includes(byte)) {
          const before = input.offset(); args.push(parser.parseObject());
          if (input.offset() <= before) fail('invalid drawing operands');
        } else {
          let op = '';
          while (!input.done() && /[A-Za-z0-9*'"]/.test(String.fromCharCode(input.peek()))) op += String.fromCharCode(input.next());
          if (!operators.has(op)) fail(op === 'BI' ? 'inline images' : 'unknown drawing instructions');
          result.push({ op, args: args.splice(0) });
          if (result.length > MAX_INSTRUCTIONS) fail('too many drawing instructions');
        }
        if (args.length > 256) fail('too many drawing operands');
      }
      if (args.length) fail('incomplete drawing instructions');
      parsed.set(stream, result); return result;
    }

    function resources(value) {
      const result = dictionary(value);
      if (resourcesSeen.has(result)) return result;
      ensureBudget(0); resourcesSeen.add(result);
      const objects = result.lookup(n('XObject'));
      if (objects && !(objects instanceof Dict)) fail('unsupported XObject dictionaries');
      if (objects && !usedByObjects.has(objects)) usedByObjects.set(objects, new Set());
      for (const [key, child] of result.entries()) {
        if (!['XObject', 'ExtGState', 'Pattern', 'Font', 'ProcSet'].includes(key.decodeText())) protect(child);
      }
      return result;
    }

    const named = (res, category, key) => {
      if (!(key instanceof Name)) fail('invalid resource names');
      const entries = res.lookup(n(category));
      if (!(entries instanceof Dict) || !entries.has(key)) fail('missing drawing resources');
      return lookup(entries.get(key));
    };

    async function form(stream, inherited, depth) {
      stream = lookup(stream);
      if (!(stream instanceof Stream)) fail('unsupported Form streams');
      if (stream.dict.has(n('Ref')) || stream.dict.has(n('OPI'))) fail('external Form resources');
      for (const [key, child] of stream.dict.entries()) if (!['Resources', 'Length', 'Filter', 'DecodeParms', 'Type', 'Subtype', 'FormType', 'BBox', 'Matrix'].includes(key.decodeText())) protect(child);
      await walk([stream], stream.dict.get(n('Resources')) || inherited, depth);
    }

    async function graphicsState(value, res, depth) {
      const state = dictionary(value), mask = state.lookup(n('SMask'));
      for (const [key, child] of state.entries()) if (key.decodeText() !== 'SMask') protect(child);
      if (!mask || mask.toString() === '/None') return;
      if (!(mask instanceof Dict) || !['/Alpha', '/Luminosity'].includes(mask.get(n('S'))?.toString())) fail('unknown soft-mask resources');
      for (const [key, child] of mask.entries()) if (key.decodeText() !== 'G') protect(child);
      await form(mask.get(n('G')), res, depth + 1);
    }

    async function pattern(value, res, depth) {
      const data = value instanceof Stream ? value.dict : dictionary(value);
      const type = numeric(data.get(n('PatternType')));
      if (type === 1 && value instanceof Stream) await form(value, res, depth + 1);
      else if (type === 2 && value instanceof Dict) {
        for (const [key, child] of data.entries()) if (key.decodeText() !== 'ExtGState') protect(child);
        if (data.has(n('ExtGState'))) await graphicsState(data.get(n('ExtGState')), res, depth + 1);
      } else fail('unknown pattern resources');
    }

    async function font(value, res, depth) {
      const data = dictionary(value);
      if (data.get(n('Subtype'))?.toString() !== '/Type3') { protect(data); return; }
      for (const [key, child] of data.entries()) if (!['Resources', 'CharProcs'].includes(key.decodeText())) protect(child);
      const glyphResources = data.get(n('Resources')) || res;
      // Analyze every glyph: character-to-glyph encodings are deliberately not guessed.
      for (const glyph of dictionary(data.get(n('CharProcs'))).values()) await walk([glyph], glyphResources, depth + 1);
    }

    async function walk(streams, resourceValue, depth = 0) {
      ensureBudget(depth); const res = resources(resourceValue);
      for (let stream of streams) {
        stream = lookup(stream);
        if (visiting.get(stream)?.has(res)) fail('recursive drawing resources');
        if (visited.get(stream)?.has(res)) continue;
        if (!visiting.has(stream)) visiting.set(stream, new Set()); visiting.get(stream).add(res);
        for (const { op, args } of operations(stream)) {
          if (++executed > MAX_INSTRUCTIONS) fail('too many drawing instructions');
          if (executed % 4096 === 0) { await yieldToBrowser(); active(); }
          if (op === 'Do') {
            if (args.length !== 1) fail('invalid XObject instruction');
            const object = named(res, 'XObject', args[0]);
            if (!(object instanceof Stream)) fail('unsupported XObjects');
            usedByObjects.get(res.lookup(n('XObject'))).add(args[0].toString());
            const type = object.dict.get(n('Subtype'))?.toString();
            if (type === '/Form') await form(object, res, depth + 1);
            else if (type === '/Image') protect(object.dict);
            else fail('unknown XObject types');
          } else if (op === 'gs') {
            if (args.length !== 1) fail('invalid graphics-state instruction');
            await graphicsState(named(res, 'ExtGState', args[0]), res, depth);
          } else if (op === 'Tf') {
            if (args.length !== 2) fail('invalid font instruction');
            await font(named(res, 'Font', args[0]), res, depth);
          } else if (['scn', 'SCN'].includes(op) && args.at(-1) instanceof Name) {
            await pattern(named(res, 'Pattern', args.at(-1)), res, depth);
          }
        }
        visiting.get(stream).delete(res);
        if (!visited.has(stream)) visited.set(stream, new Set()); visited.get(stream).add(res);
      }
    }

    async function appearances(value, res) {
      value = lookup(value);
      if (value instanceof Stream) return form(value, res, 1);
      if (!(value instanceof Dict)) fail('unknown annotation appearances');
      for (const child of value.values()) {
        const stream = lookup(child);
        if (!(stream instanceof Stream)) fail('unknown annotation appearance states');
        await form(stream, res, 1);
      }
    }

    function reachableBytes() {
      // Resources may be inherited from Parent; copyPages materializes them.
      const seen = new Set(), stack = [{ value: page.node, depth: 0 }, { value: page.node.Resources(), depth: 0 }]; let bytes = 0;
      while (stack.length) {
        let { value, depth } = stack.pop(); value = lookup(value);
        if (!value || seen.has(value)) continue;
        if (seen.size >= MAX_OBJECTS || depth > 64) fail('excessive retained resource graph');
        seen.add(value);
        if (value instanceof Stream) { bytes += value.contents.length; value = value.dict; }
        if (value instanceof Dict) {
          const isPage = value.get(n('Type'))?.toString() === '/Page';
          for (const [key, child] of value.entries()) if (!(isPage && key.decodeText() === 'Parent')) stack.push({ value: child, depth: depth + 1 });
        } else if (value instanceof Arr) for (const child of value.asArray()) stack.push({ value: child, depth: depth + 1 });
      }
      return bytes;
    }

    const applied = [];
    active();
    try {
      if (doc.getPageCount() !== 1 || doc.getPage(0) !== page) fail('multi-page source documents');
      const res = page.node.Resources(), contents = page.node.lookup(n('Contents'));
      if (contents) await walk(contents instanceof Arr ? contents.asArray() : [contents], res);
      else if (res) resources(res);
      const annots = page.node.lookup(n('Annots'));
      if (annots) {
        if (!(annots instanceof Arr)) fail('unknown annotations');
        for (const annotation of annots.asArray()) {
          const data = dictionary(annotation), ap = data.lookup(n('AP'));
          if (ap) for (const child of dictionary(ap).values()) await appearances(child, res);
          for (const [key, child] of data.entries()) if (!['AP', 'P'].includes(key.decodeText())) protect(child);
        }
      }
      for (const [key, child] of page.node.entries()) if (!['Type', 'Parent', 'Resources', 'Contents', 'Annots', 'MediaBox', 'CropBox', 'BleedBox', 'TrimBox', 'ArtBox', 'Rotate', 'UserUnit'].includes(key.decodeText())) protect(child);
      active();
      const before = reachableBytes(), replacements = new Map();
      for (const res of resourcesSeen) {
        const original = res.lookup(n('XObject'));
        if (!original || opaque.has(res) || opaque.has(original)) continue;
        if (!replacements.has(original)) {
          const clone = original.clone(context), used = usedByObjects.get(original);
          for (const key of original.keys()) if (!used.has(key.toString())) { clone.delete(key); stats.removedEntries++; }
          replacements.set(original, clone);
        }
        applied.push({ res, original: res.get(n('XObject')) });
        res.set(n('XObject'), replacements.get(original));
      }
      stats.resourceDictionaries = resourcesSeen.size;
      stats.removedEncodedBytes = Math.max(0, before - reachableBytes());
      return { warnings: [], stats };
    } catch (error) {
      for (const { res, original } of applied) res.set(n('XObject'), original);
      active();
      return { warnings: [`Unused PDF resources were kept because of ${error.message || error}.`], stats: { resourceDictionaries: resourcesSeen.size, removedEntries: 0, removedEncodedBytes: 0, skipped: true } };
    }
  }
  return { prunePage };
}
if (typeof module !== 'undefined' && module.exports) module.exports = { createPdfResourcePruner };
