#include <stdio.h>
#include <objc/runtime.h>
#include <objc/message.h>
#include <CoreFoundation/CoreFoundation.h>
#include <Security/Security.h>
int main(void) {
  id ctx = ((id(*)(id,SEL))objc_msgSend)(((id(*)(id,SEL))objc_msgSend)((id)objc_getClass("LAContext"), sel_getUid("alloc")), sel_getUid("init"));
  id err = NULL;
  BOOL owner = ((BOOL(*)(id,SEL,long,id*))objc_msgSend)(ctx, sel_getUid("canEvaluatePolicy:error:"), 2 /*deviceOwnerAuthentication*/, &err);
  long code = err ? ((long(*)(id,SEL))objc_msgSend)(err, sel_getUid("code")) : 0;
  err = NULL;
  BOOL bio = ((BOOL(*)(id,SEL,long,id*))objc_msgSend)(ctx, sel_getUid("canEvaluatePolicy:error:"), 1 /*biometrics*/, &err);
  long code2 = err ? ((long(*)(id,SEL))objc_msgSend)(err, sel_getUid("code")) : 0;
  long bt = ((long(*)(id,SEL))objc_msgSend)(ctx, sel_getUid("biometryType"));
  printf("canEvaluate deviceOwnerAuthentication=%d err=%ld, biometrics=%d err=%ld, biometryType=%ld\n", owner, code, bio, code2, bt);
  CFMutableDictionaryRef d = CFDictionaryCreateMutable(NULL, 0, &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);
  CFDictionarySetValue(d, kSecClass, kSecClassGenericPassword);
  CFDictionarySetValue(d, kSecAttrService, CFSTR("com.ryha.cydian.payment"));
  CFDictionarySetValue(d, kSecAttrAccount, CFSTR("r10probe-pc"));
  SecItemDelete(d);
  CFMutableDictionaryRef a = CFDictionaryCreateMutableCopy(NULL, 0, d);
  CFDictionarySetValue(a, kSecValueData, CFDataCreate(NULL, (const UInt8*)"x", 1));
  CFDictionarySetValue(a, kSecAttrAccessible, kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly);
  printf("add WhenPasscodeSet (no ACL): %d\n", (int)SecItemAdd(a, NULL));
  SecItemDelete(d);
  return 0;
}
