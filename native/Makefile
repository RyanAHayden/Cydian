# Cydian's jailbreak build. `make package` → build/Cydian.deb (see build.sh for the toolchain it needs).
.PHONY: package check clean
package:
	./build.sh
check:
	python3 mkdeb.py check build/Cydian.deb
clean:
	rm -rf build
