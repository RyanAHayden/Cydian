# Cydian's two builds from one shell (task I2). `make package` → build/Cydian.deb and build/Cydian.ipa (see
# build.sh for the toolchain it needs); `make deb` / `make ipa` build one.
.PHONY: package deb ipa check clean
package:
	./build.sh all
deb:
	./build.sh deb
ipa:
	./build.sh ipa
check:
	python3 mkdeb.py check build/Cydian.deb
	python3 mkipa.py check build/Cydian.ipa
clean:
	rm -rf build
