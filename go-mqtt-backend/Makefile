.PHONY: build test lint run run-debug clean tidy

BINARY  := bin/go-mqtt-consumer
ENV     ?= .env
ENV_DBG ?= .env.debug

## build: 编译生产二进制（Linux amd64 交叉编译）
build:
	CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags="-s -w" -o $(BINARY) ./cmd/consumer

## build-local: 编译本机二进制（Windows 开发用）
build-local:
	go build -o bin/go-mqtt-consumer.exe ./cmd/consumer

## test: 运行全部单元测试
test:
	go test -v -count=1 ./...

## test-cover: 运行测试 + 覆盖率报告
test-cover:
	go test -coverprofile=coverage.out ./...
	go tool cover -html=coverage.out -o coverage.html

## lint: 静态检查（需先安装 golangci-lint）
lint:
	golangci-lint run ./...

## run: 用 .env 启动（生产模式）
run:
	go run ./cmd/consumer --env-file=$(ENV)

## run-debug: 用 .env.debug 启动（调试模式）
run-debug:
	go run ./cmd/consumer --env-file=$(ENV_DBG)

## tidy: 整理依赖
tidy:
	go mod tidy

## clean: 清理编译产物
clean:
	rm -rf bin/ coverage.out coverage.html
