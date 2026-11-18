// Two calls the website's signing worker (web/app/signing-worker.js) makes into zsign's own code before main():
// unzip the IPA (zsign then signs the folder, after the worker has read the app's Info.plist and, for iFizBox's own
// IPA, added the files it carries) and read a plist (binary or XML) as JSON. Built by tools/build-zsign-wasm.sh.
#include <emscripten.h>
#include "common.h"
#include "archive.h"
#include "json.h"

extern "C" {

EMSCRIPTEN_KEEPALIVE int cydian_unzip(const char* zip, const char* dir)
{
	return Zip::Extract(zip, dir) ? 0 : 1;
}

// The plist at `path` as JSON text, or "" when it doesn't read. The buffer lives until the next call.
EMSCRIPTEN_KEEPALIVE const char* cydian_plist_json(const char* path)
{
	static string out;
	out.clear();
	jvalue v;
	if (!v.read_plist_from_file("%s", path)) return "";
	v.write(out);
	return out.c_str();
}

}
