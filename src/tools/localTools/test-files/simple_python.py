# Simple Python test file for symbol extraction
def my_func(param: str) -> str:
    """Test function docstring."""
    return f"Hello, {param}!"
    
class MyClass:
    """Test class docstring."""
    
    def __init__(self, name: str):
        self.name = name
        
    def greet(self):
        return f"Hi from {self.name}"

