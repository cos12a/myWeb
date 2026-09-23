# rust-mqtt-backend Makefile
# 对齐 HANDOFF 8.6，并补充纯 Rust 交叉编译（musl-static）与质量门禁（clippy/fmt）。
#
# 目标一览：
#   make build         默认 release 构建（含 rustls，行为对齐 HANDOFF 3.2）
#   make test          运行全部单测（期望 ≥73 全绿）
#   make clippy        cargo clippy --all-targets -- -D warnings
#   make fmt           cargo fmt（需 rustfmt）
#   make run           cargo run -- --env-file=.env
#   make run-debug     cargo run -- --env-file=.env.debug
#   make musl          x86_64-musl 静态产物（标准路径：x86_64 构建机 + musl-tools，含 TLS）
#   make musl-static   x86_64-musl 静态产物（纯 Rust + rust-lld，无需 C 交叉工具链，仅 http/明文 mqtt）
#   make clean         cargo clean

.PHONY: build build-local test clippy fmt run run-debug musl musl-static clean

MUSL_TARGET := x86_64-unknown-linux-musl
MUSL_BIN    := target/$(MUSL_TARGET)/release/rust-mqtt-consumer

build:
	cargo build --release
build-local: build

test:
	cargo test

clippy:
	cargo clippy --all-targets -- -D warnings

fmt:
	cargo fmt --all

run:
	cargo run -- --env-file=.env

run-debug:
	cargo run -- --env-file=.env.debug

# 标准路径（HANDOFF 8.2）：构建机为 Linux x86_64 且已 `apt-get install -y musl-tools`。
# ring（rustls 的 C 依赖）由 x86_64-linux-musl-gcc 编译，产物含 TLS 能力。
musl:
	rustup target add $(MUSL_TARGET)
	cargo build --release --target $(MUSL_TARGET)
	@echo "产物: $(MUSL_BIN)"
	@file $(MUSL_BIN)

# 纯 Rust 交叉路径：从非 x86_64 主机（如 aarch64）且无 C 交叉工具链时使用。
# 关闭默认 rustls 特性以移除 ring，改用 Rust 自带的 rust-lld 完成自包含静态链接。
# 产物仅支持 http:// InfluxDB 与明文 mqtt://（对齐 HANDOFF 1.4 的本机部署）。
musl-static:
	rustup target add $(MUSL_TARGET)
	RUSTFLAGS="-C linker=rust-lld" cargo build --release --no-default-features --target $(MUSL_TARGET)
	@echo "产物: $(MUSL_BIN)（static-pie，无动态依赖）"
	@file $(MUSL_BIN)

clean:
	cargo clean
