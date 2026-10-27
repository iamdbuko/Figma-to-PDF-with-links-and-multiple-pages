# Finding a printer ICC profile

CMYK export works with the built-in profile immediately. To use a profile supplied for your print job, choose **Custom printer profile** and select its `.icc` or `.icm` file. The file can be in Downloads or any other folder; you do not need to install it in your operating system first.

## On a Mac

In Finder, choose **Go → Go to Folder** (Shift–Command–G). Paste one of these locations:

- `/Library/ColorSync/Profiles` — profiles available to all users.
- `~/Library/ColorSync/Profiles` — profiles in your user account.
- `/System/Library/ColorSync/Profiles` — profiles included with macOS.

Some folders may be empty or absent. You can also open **ColorSync Utility → Profiles** to inspect installed profiles and their locations. [Apple’s profile viewer instructions](https://support.apple.com/en-mt/guide/colorsync-utility/csync003/mac) and [documented profile folders](https://developer.apple.com/documentation/applicationservices/colorsync_manager/1804907-cmgetcolorsyncfolderspec).

## On Windows

Open File Explorer, paste `%WINDIR%\System32\spool\drivers\color` into the address bar and press Enter. On a standard installation this is `C:\Windows\System32\spool\drivers\color`. [Microsoft’s documented profile location](https://learn.microsoft.com/en-us/dotnet/api/system.drawing.imaging.imageattributes.setoutputchannelcolorprofile).

## Which file should I choose?

Use a **CMYK output profile** supplied by the print shop, or a compatible profile from the printer or paper manufacturer for that printing condition. Monitor, scanner and many desktop-printer profiles use RGB; those are not accepted by this CMYK exporter. The file extension alone does not tell you whether a profile is CMYK.

If your printer has not specified a profile, the built-in profile is available as a starting point. It describes a particular coated-paper printing condition, so ask the printer which profile matches a production job. See [CMYK export behavior and limits](CMYK.md).
