// F248: a field the page focuses from script brings up the keyboard, the way WKWebView's missing
// keyboardDisplayRequiresUserAction = false would. iOS only shows the keyboard for a focus that comes straight from a
// tap; Settings > Signing focuses the Password field after a picked .p12 turns out to be locked (the file picker's
// answer, not a tap), and My IPAs' search focuses its field after the push. WKContentView's
// _elementDidFocus:userIsInteracting:… decides that: this passes userIsInteracting = true for every focus, so the
// input session starts. Both builds (jailbreak and sideload). A WebKit without the selector keeps iOS's own rule.
import ObjectiveC
import UIKit

enum FocusKeyboard {
    private static var done = false

    // The selectors WebKit has used on iOS 15 and later (the first is current WebKit), tried in order.
    static let selectors = [
        "_elementDidFocus:userIsInteracting:blurPreviousNode:activityStateChanges:userObject:",
        "_elementDidFocus:userIsInteracting:blurPreviousNode:changingActivityState:userObject:",
    ]

    // Once per process, before or after the first WKWebView: the class is WebKit's own.
    static func enable() {
        guard !done, let cls = NSClassFromString("WKContentView") else { return }
        done = true
        for name in selectors {
            let sel = NSSelectorFromString(name)
            guard let m = class_getInstanceMethod(cls, sel) else { continue }
            // (self, _cmd, const FocusedElementInformation&, userIsInteracting, blurPreviousNode,
            //  OptionSet<ActivityState> or BOOL, userObject): the C++ reference is a pointer, the option set a small
            // integer passed through in its register untouched.
            typealias Original = @convention(c) (AnyObject, Selector, UnsafeRawPointer, Bool, Bool, UInt, AnyObject?) -> Void
            let original = unsafeBitCast(method_getImplementation(m), to: Original.self)
            let block: @convention(block) (AnyObject, UnsafeRawPointer, Bool, Bool, UInt, AnyObject?) -> Void = {
                me, info, _, blur, activity, user in
                original(me, sel, info, true, blur, activity, user)
            }
            method_setImplementation(m, imp_implementationWithBlock(block))
            return
        }
    }
}
