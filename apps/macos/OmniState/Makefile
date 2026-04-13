.PHONY: build run clean dev

PROJECT_ROOT := $(shell cd ../../.. && pwd)

build:
	swift build -c release

run: build
	.build/release/OmniState

dev:
	swift build
	.build/debug/OmniState

clean:
	swift package clean

build-web:
	bash ../build-web.sh

all: build-web build
