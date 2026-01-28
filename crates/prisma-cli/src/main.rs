// Standalone Prisma CLI for generating prisma.rs
// This crate has NO dependencies on openbio-server or the generated code
// Run with: cargo run -p prisma-cli -- generate

fn main() {
    prisma_client_rust_cli::run();
}
