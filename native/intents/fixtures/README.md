# Xcode captures for metadata.py's tests

`sweetpad-dataapp.swiftconstvalues` and `sweetpad-dataapp.actionsdata` are from sweetpad
(https://github.com/sweetpad-dev/sweetpad, `sweetpad-cli/fixtures/appintents/DataApp.*`, commit 4b5b781): the Swift
compiler's constant values for a one-intent app with an App Shortcut, and what Xcode 27 (27B52)'s
appintentsmetadataprocessor wrote from them. `native/intents/test_intents.py` checks that `metadata.py` writes the same.
They are under sweetpad's MIT licence:

    Copyright (c) 2024 Yevenii Hyzyla
    
    Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
    documentation files (the "Software"), to deal in the Software without restriction, including without limitation the
    rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit
    persons to whom the Software is furnished to do so, subject to the following conditions:
    
    The above copyright notice and this permission notice shall be included in all copies or substantial portions of the
    Software.
    
    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE
    WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
    COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
    OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
