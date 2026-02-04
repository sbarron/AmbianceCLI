// Simple Rust test file for symbol extraction
/// Test module docstring
pub mod test_mod {
    /// Test function docstring
    pub fn my_func(param: &str) -> String {
        format!("Hello, {}!", param)
    }
}

fn main() {
    let result = test_mod::my_func("World");
    println!("{}", result);
}

