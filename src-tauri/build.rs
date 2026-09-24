fn main() {
    let out = std::env::var("OUT_DIR").unwrap();
    let mut objects = Vec::new();
    for source in ["src/classic-native.m", "src/classic-scripting.m"] {
        let object = format!(
            "{out}/{}.o",
            source.trim_start_matches("src/").trim_end_matches(".m")
        );
        assert!(std::process::Command::new("clang")
            .args(["-fobjc-arc", "-c", source, "-o", &object])
            .status()
            .unwrap()
            .success());
        println!("cargo:rerun-if-changed={source}");
        objects.push(object);
    }
    let archive = format!("{out}/libclassic-native.a");
    assert!(std::process::Command::new("ar")
        .args(["crs", &archive])
        .args(&objects)
        .status()
        .unwrap()
        .success());
    println!("cargo:rustc-link-search=native={out}");
    println!("cargo:rustc-link-lib=static=classic-native");
    println!("cargo:rustc-link-lib=framework=Cocoa");
    tauri_build::build()
}
