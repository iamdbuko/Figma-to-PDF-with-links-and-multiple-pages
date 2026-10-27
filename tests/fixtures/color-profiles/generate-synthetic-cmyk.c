//---------------------------------------------------------------------------------
//
//  Little Color Management System
//  Copyright (c) 1998-2026 Marti Maria Saguer
//
// Permission is hereby granted, free of charge, to any person obtaining
// a copy of this software and associated documentation files (the "Software"),
// to deal in the Software without restriction, including without limitation
// the rights to use, copy, modify, merge, publish, distribute, sublicense,
// and/or sell copies of the Software, and to permit persons to whom the Software
// is furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
// EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO
// THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
// NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
// LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
// OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
// WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
//
//---------------------------------------------------------------------------------
//

// Adapted from Little-CMS testbed/testcms2.c CreateFakeCMYK (MIT).
// https://github.com/mm2/Little-CMS/blob/master/testbed/testcms2.c
// Synthetic regression fixture ONLY. Not a printer profile.
// Uses 9-point CLUTs and public identity-curve APIs, plus explicit test labels.
// Generate: cc -I<lcms-include> -L<lcms-lib> generate-synthetic-cmyk.c -llcms2 -o /tmp/make-cmyk
// Then: /tmp/make-cmyk synthetic-cmyk-test-only.icc
#include <lcms2.h>
#include <stdio.h>
#define cmsmin(a,b) (((a)<(b))?(a):(b))
// Create a fake CMYK profile, without any other requirement that being coarse CMYK.
// DON'T USE THIS PROFILE FOR ANYTHING, IT IS USELESS BUT FOR TESTING PURPOSES.
typedef struct {

    cmsHTRANSFORM hLab2sRGB;
    cmsHTRANSFORM sRGB2Lab;
    cmsHTRANSFORM hIlimit;

} FakeCMYKParams;

static
cmsFloat64Number Clip(cmsFloat64Number v)
{
    if (v < 0) return 0;
    if (v > 1) return 1;

    return v;
}

static
cmsInt32Number ForwardSampler(CMSREGISTER const cmsUInt16Number In[], cmsUInt16Number Out[], void* Cargo)
{
    FakeCMYKParams* p = (FakeCMYKParams*) Cargo;
    cmsFloat64Number rgb[3], cmyk[4];
    cmsFloat64Number c, m, y, k;

    cmsDoTransform(p ->hLab2sRGB, In, rgb, 1);

    c = 1 - rgb[0];
    m = 1 - rgb[1];
    y = 1 - rgb[2];

    k = (c < m ? cmsmin(c, y) : cmsmin(m, y));

    // NONSENSE WARNING!: I'm doing this just because this is a test
    // profile that may have ink limit up to 400%. There is no UCR here
    // so the profile is basically useless for anything but testing.

    cmyk[0] = c;
    cmyk[1] = m;
    cmyk[2] = y;
    cmyk[3] = k;

    cmsDoTransform(p ->hIlimit, cmyk, Out, 1);

    return 1;
}


static
cmsInt32Number ReverseSampler(CMSREGISTER const cmsUInt16Number In[], CMSREGISTER cmsUInt16Number Out[], CMSREGISTER void* Cargo)
{
    FakeCMYKParams* p = (FakeCMYKParams*) Cargo;
    cmsFloat64Number c, m, y, k, rgb[3];

    c = In[0] / 65535.0;
    m = In[1] / 65535.0;
    y = In[2] / 65535.0;
    k = In[3] / 65535.0;

    if (k == 0) {

        rgb[0] = Clip(1 - c);
        rgb[1] = Clip(1 - m);
        rgb[2] = Clip(1 - y);
    }
    else
        if (k == 1) {

            rgb[0] = rgb[1] = rgb[2] = 0;
        }
        else {

            rgb[0] = Clip((1 - c) * (1 - k));
            rgb[1] = Clip((1 - m) * (1 - k));
            rgb[2] = Clip((1 - y) * (1 - k));
        }

    cmsDoTransform(p ->sRGB2Lab, rgb, Out, 1);
    return 1;
}



static
cmsHPROFILE CreateFakeCMYK(cmsFloat64Number InkLimit, cmsBool lUseAboveRGB)
{
    cmsHPROFILE hICC;
    cmsPipeline* AToB0, *BToA0;
    cmsStage* CLUT;
    cmsContext ContextID;
    FakeCMYKParams p;
    cmsHPROFILE hLab, hsRGB, hLimit;
    cmsUInt32Number cmykfrm;


    hsRGB = cmsCreate_sRGBProfile();

    hLab   = cmsCreateLab4Profile(NULL);
    hLimit = cmsCreateInkLimitingDeviceLink(cmsSigCmykData, InkLimit);

    cmykfrm = FLOAT_SH(1) | BYTES_SH(0)|CHANNELS_SH(4);
    p.hLab2sRGB = cmsCreateTransform(hLab,  TYPE_Lab_16,  hsRGB, TYPE_RGB_DBL, INTENT_PERCEPTUAL, cmsFLAGS_NOOPTIMIZE|cmsFLAGS_NOCACHE);
    p.sRGB2Lab  = cmsCreateTransform(hsRGB, TYPE_RGB_DBL, hLab,  TYPE_Lab_16,  INTENT_PERCEPTUAL, cmsFLAGS_NOOPTIMIZE|cmsFLAGS_NOCACHE);
    p.hIlimit   = cmsCreateTransform(hLimit, cmykfrm, NULL, TYPE_CMYK_16, INTENT_PERCEPTUAL, cmsFLAGS_NOOPTIMIZE|cmsFLAGS_NOCACHE);

    cmsCloseProfile(hLab); cmsCloseProfile(hsRGB); cmsCloseProfile(hLimit);

    ContextID = NULL;
    hICC = cmsCreateProfilePlaceholder(ContextID);
    if (!hICC) return NULL;

    cmsSetProfileVersion(hICC, 4.3);

    cmsSetDeviceClass(hICC, cmsSigOutputClass);
    cmsSetColorSpace(hICC,  cmsSigCmykData);
    cmsSetPCS(hICC,         cmsSigLabData);

    BToA0 = cmsPipelineAlloc(ContextID, 3, 4);
    if (BToA0 == NULL) return 0;
    CLUT = cmsStageAllocCLut16bit(ContextID, 9, 3, 4, NULL);
    if (CLUT == NULL) return 0;
    if (!cmsStageSampleCLut16bit(CLUT, ForwardSampler, &p, 0)) return 0;

    cmsPipelineInsertStage(BToA0, cmsAT_BEGIN, cmsStageAllocToneCurves(ContextID, 3, NULL));
    cmsPipelineInsertStage(BToA0, cmsAT_END, CLUT);
    cmsPipelineInsertStage(BToA0, cmsAT_END, cmsStageAllocToneCurves(ContextID, 4, NULL));

    if (!cmsWriteTag(hICC, cmsSigBToA0Tag, (void*) BToA0)) return 0;
    cmsPipelineFree(BToA0);

    AToB0 = cmsPipelineAlloc(ContextID, 4, 3);
    if (AToB0 == NULL) return 0;
    CLUT = cmsStageAllocCLut16bit(ContextID, 9, 4, 3, NULL);
    if (CLUT == NULL) return 0;
    if (!cmsStageSampleCLut16bit(CLUT, ReverseSampler, &p, 0)) return 0;

    cmsPipelineInsertStage(AToB0, cmsAT_BEGIN, cmsStageAllocToneCurves(ContextID, 4, NULL));
    cmsPipelineInsertStage(AToB0, cmsAT_END, CLUT);
    cmsPipelineInsertStage(AToB0, cmsAT_END, cmsStageAllocToneCurves(ContextID, 3, NULL));

    if (!cmsWriteTag(hICC, cmsSigAToB0Tag, (void*) AToB0)) return 0;
    cmsPipelineFree(AToB0);

    cmsDeleteTransform(p.hLab2sRGB);
    cmsDeleteTransform(p.sRGB2Lab);
    cmsDeleteTransform(p.hIlimit);

    cmsLinkTag(hICC, cmsSigAToB1Tag, cmsSigAToB0Tag);
    cmsLinkTag(hICC, cmsSigAToB2Tag, cmsSigAToB0Tag);
    cmsLinkTag(hICC, cmsSigBToA1Tag, cmsSigBToA0Tag);
    cmsLinkTag(hICC, cmsSigBToA2Tag, cmsSigBToA0Tag);

    return hICC;
}



int main(int argc, char **argv) {
    if (argc != 2) return 2;
    cmsHPROFILE p = CreateFakeCMYK(300, 0);
    if (!p) return 3;
    cmsMLU *label = cmsMLUalloc(NULL, 1);
    cmsMLUsetASCII(label, "en", "US", "SYNTHETIC CMYK TEST ONLY - NOT FOR PRINTING");
    cmsWriteTag(p, cmsSigProfileDescriptionTag, label);
    cmsMLUfree(label);
    label = cmsMLUalloc(NULL, 1);
    cmsMLUsetASCII(label, "en", "US", "MIT; derived from Little-CMS testbed; synthetic test data only");
    cmsWriteTag(p, cmsSigCopyrightTag, label);
    cmsMLUfree(label);
    cmsWriteTag(p, cmsSigMediaWhitePointTag, cmsD50_XYZ());
    int ok = cmsSaveProfileToFile(p, argv[1]);
    cmsCloseProfile(p);
    if (!ok) return 4;
    FILE *f = fopen(argv[1], "r+b");
    if (!f) return 5;
    unsigned char date[12] = {7,234,0,1,0,1,0,0,0,0,0,0};
    unsigned char id[16] = {0};
    fseek(f, 24, SEEK_SET); fwrite(date, 1, 12, f);
    fseek(f, 84, SEEK_SET); fwrite(id, 1, 16, f);
    fclose(f);
    return 0;
}
