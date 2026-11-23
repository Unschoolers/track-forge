fn main() {
    // The web artifact is the application content, not a runtime dependency.
    // Recompile if it changes even when Cargo's source files have not.
    println!("cargo:rerun-if-changed=../dist");
    tauri_build::build()
}
