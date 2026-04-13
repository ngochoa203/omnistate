.PHONY: build run clean dev package run-app all

PROJECT_ROOT := $(shell cd ../../.. && pwd)

build:
	swift build -c release

package: build
	rm -rf dist/OmniState.app
	mkdir -p dist/OmniState.app/Contents/MacOS dist/OmniState.app/Contents/Resources
	cp .build/release/OmniState dist/OmniState.app/Contents/MacOS/OmniState
	chmod +x dist/OmniState.app/Contents/MacOS/OmniState
	sed -e 's|$$(EXECUTABLE_NAME)|OmniState|g' -e 's|$$(PRODUCT_BUNDLE_IDENTIFIER)|com.omnistate.app|g' -e 's|$$(PRODUCT_NAME)|OmniState|g' OmniState/Info.plist > dist/OmniState.app/Contents/Info.plist
	cp -R OmniState/Resources/. dist/OmniState.app/Contents/Resources/
	plutil -lint dist/OmniState.app/Contents/Info.plist >/dev/null
	codesign --force --deep --sign - dist/OmniState.app
	codesign --verify --deep --strict dist/OmniState.app

run: build
	.build/release/OmniState

dev:
	swift build
	.build/debug/OmniState

run-app: package
	open dist/OmniState.app

clean:
	swift package clean

build-web:
	bash ../build-web.sh

all: package
