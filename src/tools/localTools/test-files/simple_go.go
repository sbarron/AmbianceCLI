// Simple Go test file for symbol extraction
package main

import "fmt"

// Test function
func myFunc(param string) string {
    return fmt.Sprintf("Hello, %s!", param)
}

func main() {
    result := myFunc("World")
    fmt.Println(result)
}

