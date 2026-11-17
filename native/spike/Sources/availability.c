// __isPlatformVersionAtLeast backs Swift's #available. Xcode links it from compiler-rt (libclang_rt.ios.a), which
// a Linux clang doesn't ship for iOS; this is compiler-rt's own implementation over dyld's version check (iOS 14+).
#include <stdint.h>
typedef struct { uint32_t platform; uint32_t version; } dyld_build_version_t;
extern _Bool _availability_version_check(uint32_t count, dyld_build_version_t versions[]);
int32_t __isPlatformVersionAtLeast(uint32_t platform, uint32_t major, uint32_t minor, uint32_t subminor) {
  dyld_build_version_t v = {platform, (major << 16) | ((minor & 0xff) << 8) | (subminor & 0xff)};
  return _availability_version_check(1, &v);
}
