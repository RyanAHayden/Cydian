#include <stdio.h>
#include <dlfcn.h>
#include <CoreFoundation/CoreFoundation.h>
#include <Security/Security.h>
static CFMutableDictionaryRef q(const char *acct, int group) {
  CFMutableDictionaryRef d = CFDictionaryCreateMutable(NULL, 0, &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);
  CFDictionarySetValue(d, kSecClass, kSecClassGenericPassword);
  CFDictionarySetValue(d, kSecAttrService, CFSTR("com.ryha.cydian.payment"));
  CFStringRef a = CFStringCreateWithCString(NULL, acct, kCFStringEncodingUTF8);
  CFDictionarySetValue(d, kSecAttrAccount, a);
  if (group) CFDictionarySetValue(d, kSecAttrAccessGroup, CFSTR("com.ryha.cydian"));
  return d;
}
int main(void) {
  void *mg = dlopen("/usr/lib/libMobileGestalt.dylib", RTLD_NOW);
  CFTypeRef (*MGCopyAnswer)(CFStringRef) = mg ? dlsym(mg, "MGCopyAnswer") : NULL;
  CFTypeRef u = MGCopyAnswer ? MGCopyAnswer(CFSTR("UniqueDeviceID")) : NULL;
  char buf[128] = "(nil)";
  if (u && CFGetTypeID(u) == CFStringGetTypeID()) CFStringGetCString(u, buf, sizeof buf, kCFStringEncodingUTF8);
  printf("UniqueDeviceID: %s\n", buf);
  for (int g = 1; g >= 0; g--) {
    CFMutableDictionaryRef d = q("r10probe", g);
    SecItemDelete(d);
    CFMutableDictionaryRef add = q("r10probe", g);
    CFDataRef v = CFDataCreate(NULL, (const UInt8 *)"secret", 6);
    CFDictionarySetValue(add, kSecValueData, v);
    CFDictionarySetValue(add, kSecAttrAccessible, kSecAttrAccessibleWhenUnlockedThisDeviceOnly);
    OSStatus s = SecItemAdd(add, NULL);
    printf("group=%d add plain: %d\n", g, (int)s);
    CFMutableDictionaryRef get = q("r10probe", g);
    CFDictionarySetValue(get, kSecReturnData, kCFBooleanTrue);
    CFTypeRef out = NULL;
    s = SecItemCopyMatching(get, &out);
    printf("group=%d get plain: %d len=%ld\n", g, (int)s, out ? (long)CFDataGetLength(out) : -1L);
    printf("group=%d delete plain: %d\n", g, (int)SecItemDelete(d));
    CFErrorRef e = NULL;
    SecAccessControlRef ac = SecAccessControlCreateWithFlags(NULL, kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly, kSecAccessControlUserPresence, &e);
    CFMutableDictionaryRef add2 = q("r10probe-ac", g);
    SecItemDelete(add2);
    CFDictionarySetValue(add2, kSecValueData, v);
    CFDictionarySetValue(add2, kSecAttrAccessControl, ac);
    s = SecItemAdd(add2, NULL);
    printf("group=%d add userPresence: %d\n", g, (int)s);
    printf("group=%d delete userPresence: %d\n", g, (int)SecItemDelete(q("r10probe-ac", g)));
  }
  return 0;
}
