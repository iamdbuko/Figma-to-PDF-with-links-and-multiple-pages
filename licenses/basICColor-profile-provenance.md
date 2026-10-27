# Bundled production CMYK profile

- Original filename: `ISOcoated_v2_300_bas.ICC`
- Profile description: `ISO Coated v2 300% (basICColor)`
- Creator: basICColor GmbH / Color Solutions
- Bundled location: `assets/color-profiles/ISOcoated_v2_300_bas.ICC`
- Size: 1,052,612 bytes
- SHA-256: `b424c77f40c3423c925536f8ae08634985ccd0fe80eb253d5d229197ded7e886`
- Profile bytes and original filename are unchanged.

This is a production CMYK output profile based on FOGRA39L characterization
data, for sheetfed offset printing on gloss or matte coated paper (paper types
1 and 2), ISO 12647-2:2004/Amd 1, with a 300% total ink limit. It describes an
older, specific printing condition. It is not a universal printer profile;
use the printer's requested profile when one is supplied.

## Source and verification

Retrieved on 2026-10-27 from OpenICC's official package distribution:

- [OpenICC basICColor package listing](https://sourceforge.net/projects/openicc/files/basICColor-Profiles/)
- [Original archive, version 1.2.0](https://downloads.sourceforge.net/project/openicc/basICColor-Profiles/icc-profiles-basiccolor-printing2009-1.2.0.tar.gz)
- Archive SHA-256: `9dfe89f08c934ad4b5ec9d3eda1f1cccb959168ba1ca873a9790deb5236d61d4`
- Archive member: `icc-profiles-basiccolor-printing2009-1.2.0/default_profiles/printing/ISOcoated_v2_300_bas.ICC`

The initially retrieved [Debian source mirror copy](https://sources.debian.org/data/main/i/icc-profiles-free/2.4/icc-profiles-basiccolor-printing2009/default_profiles/printing/ISOcoated_v2_300_bas.ICC)
was compared byte-for-byte with that original archive member; they are identical.
The bundled license is copied verbatim from the archive's `COPYING` file.
Profile conditions are documented in the archive's
`default_profiles/printing/ISOcoated_v2_300_basICC.pdf`.

The build checks the profile SHA-256 before embedding its bytes into the UI.
It requires no runtime download and includes the original license notice.

## License

The profile is distributed under the **zlib/libpng license** in
[basICColor-zlib.txt](basICColor-zlib.txt), copyright (c) 2007-2010 basICColor GmbH.
This permits commercial use and redistribution subject to the notice,
attribution/origin and alteration-marking conditions in that license.

The original ICC copyright tag predates the licensing change and still refers
to Color Solutions' 2006-2007 copyright. The later grant is explicitly confirmed
by the profile owner's [2010 licensing announcement](https://lists.freedesktop.org/archives/openicc/2010q3/002218.html),
which is also referenced by the original package's README. No alteration was
made to the ICC copyright tag or any other profile bytes.

The bundled default is the basICColor profile, not ECI's similarly named profile.
ECI's current PSO Coated v3 profile was evaluated, but its embedded license does
not grant unrestricted redistribution in a plugin. No ECI profile is bundled.
