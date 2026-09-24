fn main() {
    let out = std::env::var("OUT_DIR").unwrap();
    let object = format!("{out}/classic-native.o");
    assert!(std::process::Command::new("clang")
        .args(["-fobjc-arc", "-c", "src/classic-native.m", "-o", &object])
        .status()
        .unwrap()
        .success());
    assert!(std::process::Command::new("ar")
        .args(["crs", &format!("{out}/libclassic-native.a"), &object])
        .status()
        .unwrap()
        .success());
    println!("cargo:rerun-if-changed=src/classic-native.m");
    println!("cargo:rustc-link-search=native={out}");
    println!("cargo:rustc-link-lib=static=classic-native");
    println!("cargo:rustc-link-lib=framework=Cocoa");
    tauri_build::build()
}
