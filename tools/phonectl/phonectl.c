// phonectl: drive a jailbroken iOS 15+ phone's screen from the shell (the iPhone 7 test phone, `ssh 7`).
//   phonectl size                    screen size in pixels ("750 1334")
//   phonectl tap X Y                 tap at pixel X,Y (screenshot pixels, portrait)
//   phonectl swipe X1 Y1 X2 Y2 [S]   drag from X1,Y1 to X2,Y2 over S seconds (default 0.3)
//   phonectl home                    press the Home button
//   phonectl lock                    press the side (lock) button
//   phonectl shot FILE.png|-         screenshot as PNG (- writes it to stdout)
// Touches go through IOHIDEventSystemClientDispatchEvent, screenshots through CARenderServerRenderDisplay.
// Private symbols come from dlsym so the SDK's .tbd stubs don't need them. Build: tools/phonectl/build.sh.
#include <CoreFoundation/CoreFoundation.h>
#include <CoreGraphics/CoreGraphics.h>
#include <IOSurface/IOSurfaceRef.h>
#include <ImageIO/ImageIO.h>
#include <dlfcn.h>
#include <mach/mach_time.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

typedef struct __IOHIDEvent *IOHIDEventRef;
typedef struct __IOHIDEventSystemClient *IOHIDEventSystemClientRef;

static IOHIDEventSystemClientRef (*ClientCreate)(CFAllocatorRef);
static void (*Dispatch)(IOHIDEventSystemClientRef, IOHIDEventRef);
static IOHIDEventRef (*DigitizerEvent)(CFAllocatorRef, uint64_t, uint32_t, uint32_t, uint32_t, uint32_t, uint32_t,
                                       double, double, double, double, double, Boolean, Boolean, uint32_t);
static IOHIDEventRef (*FingerEvent)(CFAllocatorRef, uint64_t, uint32_t, uint32_t, uint32_t, double, double, double,
                                    double, double, double, double, double, double, double, Boolean, Boolean,
                                    uint32_t);
static IOHIDEventRef (*KeyboardEvent)(CFAllocatorRef, uint64_t, uint32_t, uint32_t, Boolean, uint32_t);
static void (*AppendEvent)(IOHIDEventRef, IOHIDEventRef, uint32_t);
static void (*SetInteger)(IOHIDEventRef, uint32_t, int);
static void (*SetSender)(IOHIDEventRef, uint64_t);
static void (*RenderDisplay)(mach_port_t, CFStringRef, IOSurfaceRef, int, int);
static CFTypeRef (*MGCopyAnswer)(CFStringRef);

static IOHIDEventSystemClientRef client;
static CFArrayRef (*CopyServices)(IOHIDEventSystemClientRef);
static CFTypeRef (*ServiceCopyProperty)(CFTypeRef, CFStringRef);
static CFTypeRef (*ServiceRegistryID)(CFTypeRef);
static uint64_t touch_sender;

static void *sym(void *lib, const char *name) {
  void *p = lib ? dlsym(lib, name) : NULL;
  if (!p) { fprintf(stderr, "phonectl: missing symbol %s\n", name); exit(2); }
  return p;
}

static void load_hid(void) {
  void *io = dlopen("/System/Library/Frameworks/IOKit.framework/IOKit", RTLD_NOW);
  ClientCreate = sym(io, "IOHIDEventSystemClientCreate");
  Dispatch = sym(io, "IOHIDEventSystemClientDispatchEvent");
  DigitizerEvent = sym(io, "IOHIDEventCreateDigitizerEvent");
  FingerEvent = sym(io, "IOHIDEventCreateDigitizerFingerEventWithQuality");
  KeyboardEvent = sym(io, "IOHIDEventCreateKeyboardEvent");
  AppendEvent = sym(io, "IOHIDEventAppendEvent");
  SetInteger = sym(io, "IOHIDEventSetIntegerValue");
  SetSender = sym(io, "IOHIDEventSetSenderID");
  CopyServices = sym(io, "IOHIDEventSystemClientCopyServices");
  ServiceCopyProperty = sym(io, "IOHIDServiceClientCopyProperty");
  ServiceRegistryID = sym(io, "IOHIDServiceClientGetRegistryID");
  client = ClientCreate(kCFAllocatorDefault);
  if (!client) { fprintf(stderr, "phonectl: IOHIDEventSystemClientCreate failed\n"); exit(2); }
}

static int int_prop(CFTypeRef svc, const char *key) {
  CFStringRef k = CFStringCreateWithCString(NULL, key, kCFStringEncodingUTF8);
  CFTypeRef v = ServiceCopyProperty(svc, k);
  CFRelease(k);
  int n = -1;
  if (v && CFGetTypeID(v) == CFNumberGetTypeID()) CFNumberGetValue(v, kCFNumberIntType, &n);
  if (v) CFRelease(v);
  return n;
}

// backboardd only takes touches whose sender is the built-in touchscreen: digitizer page 0x0D, touch screen 0x04.
static uint64_t find_touch_sender(void) {
  CFArrayRef svcs = CopyServices(client);
  uint64_t id = 0;
  for (CFIndex i = 0; svcs && i < CFArrayGetCount(svcs) && !id; i++) {
    CFTypeRef svc = CFArrayGetValueAtIndex(svcs, i);
    if (int_prop(svc, "PrimaryUsagePage") == 0x0D && int_prop(svc, "PrimaryUsage") == 0x04) {
      CFTypeRef rid = ServiceRegistryID(svc);
      if (rid) CFNumberGetValue(rid, kCFNumberSInt64Type, &id);
    }
  }
  if (svcs) CFRelease(svcs);
  return id;
}

// Pixel size of the main display. PHONECTL_SIZE="W H" overrides it.
static void screen_size(double *w, double *h) {
  const char *env = getenv("PHONECTL_SIZE");
  if (env && sscanf(env, "%lf %lf", w, h) == 2) return;
  void *mg = dlopen("/usr/lib/libMobileGestalt.dylib", RTLD_NOW);
  MGCopyAnswer = sym(mg, "MGCopyAnswer");
  CGSize s = {0, 0};
  CFNumberRef cw = MGCopyAnswer(CFSTR("main-screen-width")), ch = MGCopyAnswer(CFSTR("main-screen-height"));
  if (cw) { CFNumberGetValue(cw, kCFNumberDoubleType, &s.width); CFRelease(cw); }
  if (ch) { CFNumberGetValue(ch, kCFNumberDoubleType, &s.height); CFRelease(ch); }
  if (s.width <= 0 || s.height <= 0) {
    fprintf(stderr, "phonectl: can't read the display size; set PHONECTL_SIZE=\"W H\"\n");
    exit(2);
  }
  // Portrait: the smaller side is the width.
  *w = s.width < s.height ? s.width : s.height;
  *h = s.width < s.height ? s.height : s.width;
}

// Sender ID of a built-in digitizer; backboardd drops events with no sender. Same value other touch tools use.
#define SENDER 0x000000010000027FULL
#define FIELD_DISPLAY_INTEGRATED ((11u << 16) | 25)  // kIOHIDEventFieldDigitizerIsDisplayIntegrated
#define FIELD_BUILT_IN 4                              // kIOHIDEventFieldIsBuiltIn: backboardd ignores external touches
enum { RANGE = 1, TOUCH = 2, POSITION = 4 };            // kIOHIDDigitizerEvent* masks

static void touch(double nx, double ny, int phase) {  // phase 0 down, 1 move, 2 up
  uint64_t now = mach_absolute_time();
  Boolean down = phase != 2;
  uint32_t mask = phase == 1 ? POSITION : (RANGE | TOUCH);
  IOHIDEventRef hand = DigitizerEvent(kCFAllocatorDefault, now, 3 /* hand */, 0, 0, mask, 0, nx, ny, 0, 0, 0,
                                      down, down, 0);
  SetInteger(hand, FIELD_DISPLAY_INTEGRATED, 1);
  SetInteger(hand, FIELD_BUILT_IN, 1);
  IOHIDEventRef finger = FingerEvent(kCFAllocatorDefault, now, 1, 2, mask, nx, ny, 0, down ? 0.5 : 0, 0, 5, 5,
                                     1, 1, 1, down, down, 0);
  SetInteger(finger, FIELD_DISPLAY_INTEGRATED, 1);
  SetInteger(finger, FIELD_BUILT_IN, 1);
  AppendEvent(hand, finger, 0);
  SetSender(hand, touch_sender);
  Dispatch(client, hand);
  CFRelease(finger);
  CFRelease(hand);
}

static void button(uint32_t page, uint32_t usage) {
  for (int down = 1; down >= 0; down--) {
    IOHIDEventRef e = KeyboardEvent(kCFAllocatorDefault, mach_absolute_time(), page, usage, down, 0);
    SetSender(e, SENDER);
    Dispatch(client, e);
    CFRelease(e);
    if (down) usleep(80000);
  }
}

static int shot(const char *path) {
  double w, h;
  screen_size(&w, &h);
  void *qc = dlopen("/System/Library/Frameworks/QuartzCore.framework/QuartzCore", RTLD_NOW);
  RenderDisplay = sym(qc, "CARenderServerRenderDisplay");
  int iw = (int)w, ih = (int)h, bpr = (int)IOSurfaceAlignProperty(kIOSurfaceBytesPerRow, iw * 4);  // 750*4 isn't aligned
  int fmt = 'BGRA';
  CFNumberRef nw = CFNumberCreate(NULL, kCFNumberIntType, &iw), nh = CFNumberCreate(NULL, kCFNumberIntType, &ih);
  int bpe = 4, alloc = bpr * ih;
  CFNumberRef nbpe = CFNumberCreate(NULL, kCFNumberIntType, &bpe), nbpr = CFNumberCreate(NULL, kCFNumberIntType, &bpr);
  CFNumberRef nfmt = CFNumberCreate(NULL, kCFNumberIntType, &fmt), nalloc = CFNumberCreate(NULL, kCFNumberIntType, &alloc);
  const void *k[] = {kIOSurfaceWidth, kIOSurfaceHeight, kIOSurfaceBytesPerElement, kIOSurfacePixelFormat,
                     kIOSurfaceBytesPerRow, kIOSurfaceAllocSize};
  const void *v[] = {nw, nh, nbpe, nfmt, nbpr, nalloc};
  CFDictionaryRef props = CFDictionaryCreate(NULL, k, v, 6, &kCFTypeDictionaryKeyCallBacks,
                                             &kCFTypeDictionaryValueCallBacks);
  IOSurfaceRef surf = IOSurfaceCreate(props);
  if (!surf) { fprintf(stderr, "phonectl: IOSurfaceCreate failed\n"); return 1; }
  RenderDisplay(0, CFSTR("LCD"), surf, 0, 0);
  IOSurfaceLock(surf, kIOSurfaceLockReadOnly, NULL);
  size_t row = IOSurfaceGetBytesPerRow(surf);
  CGColorSpaceRef cs = CGColorSpaceCreateDeviceRGB();
  CGDataProviderRef dp = CGDataProviderCreateWithData(NULL, IOSurfaceGetBaseAddress(surf), row * ih, NULL);
  CGImageRef img = CGImageCreate(iw, ih, 8, 32, row, cs, kCGBitmapByteOrder32Little | kCGImageAlphaNoneSkipFirst,
                                 dp, NULL, false, kCGRenderingIntentDefault);
  int to_stdout = !strcmp(path, "-");  // "-": PNG on stdout, so a setuid run leaves no root-owned file behind
  CFMutableDataRef data = CFDataCreateMutable(NULL, 0);
  CGImageDestinationRef dst;
  if (to_stdout) {
    dst = CGImageDestinationCreateWithData(data, CFSTR("public.png"), 1, NULL);
  } else {
    CFURLRef url = CFURLCreateFromFileSystemRepresentation(NULL, (const UInt8 *)path, strlen(path), false);
    dst = CGImageDestinationCreateWithURL(url, CFSTR("public.png"), 1, NULL);
  }
  int ok = 0;
  if (dst) {
    CGImageDestinationAddImage(dst, img, NULL);
    ok = CGImageDestinationFinalize(dst);
    CFRelease(dst);
  }
  if (ok && to_stdout) ok = fwrite(CFDataGetBytePtr(data), 1, CFDataGetLength(data), stdout) == (size_t)CFDataGetLength(data);
  IOSurfaceUnlock(surf, kIOSurfaceLockReadOnly, NULL);
  if (!ok) { fprintf(stderr, "phonectl: couldn't write %s\n", path); return 1; }
  return 0;
}

static void usage(void) {
  fputs("usage: phonectl size | tap X Y | swipe X1 Y1 X2 Y2 [secs] | home | lock | shot FILE.png\n", stderr);
  exit(64);
}

int main(int argc, char **argv) {
  if (argc < 2) usage();
  const char *cmd = argv[1];
  if (!strcmp(cmd, "shot") && argc == 3) return shot(argv[2]);
  double w, h;
  if (!strcmp(cmd, "size")) { screen_size(&w, &h); printf("%.0f %.0f\n", w, h); return 0; }
  load_hid();
  if (!strcmp(cmd, "home")) { button(0x0C, 0x40); return 0; }  // consumer page, Menu
  if (!strcmp(cmd, "lock")) { button(0x0C, 0x30); return 0; }  // consumer page, Power
  if (!strcmp(cmd, "sender")) { printf("0x%llx\n", (unsigned long long)find_touch_sender()); return 0; }
  screen_size(&w, &h);
  touch_sender = find_touch_sender();
  if (!touch_sender) touch_sender = SENDER;  // fall back to the value other tools use
  if (!strcmp(cmd, "tap") && argc == 4) {
    double x = atof(argv[2]) / w, y = atof(argv[3]) / h;
    touch(x, y, 0);
    usleep(60000);
    touch(x, y, 2);
    return 0;
  }
  if (!strcmp(cmd, "swipe") && (argc == 6 || argc == 7)) {
    double x1 = atof(argv[2]) / w, y1 = atof(argv[3]) / h, x2 = atof(argv[4]) / w, y2 = atof(argv[5]) / h;
    double secs = argc == 7 ? atof(argv[6]) : 0.3;
    int steps = (int)(secs * 60) < 2 ? 2 : (int)(secs * 60);  // ~60 Hz
    touch(x1, y1, 0);
    for (int i = 1; i <= steps; i++) {
      usleep((useconds_t)(secs * 1e6 / steps));
      double t = (double)i / steps;
      touch(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, 1);
    }
    touch(x2, y2, 2);
    return 0;
  }
  usage();
}
