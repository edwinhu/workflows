#!/usr/bin/env python3
"""A trivial Python file."""

def greet(name: str = "World") -> str:
    return f"Hello, {name}!"

if __name__ == "__main__":
    print(greet())
