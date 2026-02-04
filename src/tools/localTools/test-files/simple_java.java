/**
 * Simple Java test file for symbol extraction
 */
public class MyClass {
    private String name;
    
    /**
     * Constructor docstring
     */
    public MyClass(String name) {
        this.name = name;
    }
    
    /**
     * Test method docstring
     */
    public String sayHello() {
        return "Hello from " + this.name + "!";
    }
    
    public static void main(String[] args) {
        MyClass obj = new MyClass("World");
        System.out.println(obj.sayHello());
    }
}

