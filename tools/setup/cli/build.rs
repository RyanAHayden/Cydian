// The product's name and domain come from native/brand.env (F170), never spelled in the command's code.
use std::fs;
use std::path::Path;

fn main() {
    let env = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../native/brand.env");
    println!("cargo:rerun-if-changed={}", env.display());
    let text = fs::read_to_string(&env).unwrap_or_else(|e| panic!("{}: {e}", env.display()));
    for key in ["BRAND_NAME", "BRAND_DOMAIN"] {
        let v = text
            .lines()
            .find_map(|l| l.strip_prefix(&format!("{key}=")))
            .unwrap_or_else(|| panic!("{key} missing from {}", env.display()));
        let v = v.split('#').next().unwrap().trim();
        println!("cargo:rustc-env={key}={v}");
    }
}
