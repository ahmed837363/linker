"""
Run this script to create the Linker Pro project structure.
Usage: python bootstrap.py
"""
import os

BASE = os.path.dirname(os.path.abspath(__file__))

DIRS = [
    "docs",
    "database",
    "app",
    os.path.join("app", "api"),
    os.path.join("app", "api", "routes"),
    os.path.join("app", "core"),
    os.path.join("app", "models"),
    os.path.join("app", "schemas"),
    os.path.join("app", "services"),
    os.path.join("app", "services", "platforms"),
    os.path.join("app", "workers"),
    "tests",
]

INIT_FILES = [
    os.path.join("app", "__init__.py"),
    os.path.join("app", "api", "__init__.py"),
    os.path.join("app", "api", "routes", "__init__.py"),
    os.path.join("app", "core", "__init__.py"),
    os.path.join("app", "models", "__init__.py"),
    os.path.join("app", "schemas", "__init__.py"),
    os.path.join("app", "services", "__init__.py"),
    os.path.join("app", "services", "platforms", "__init__.py"),
    os.path.join("app", "workers", "__init__.py"),
    os.path.join("tests", "__init__.py"),
]

def main():
    for d in DIRS:
        path = os.path.join(BASE, d)
        os.makedirs(path, exist_ok=True)
        print(f"  Created: {d}/")

    for f in INIT_FILES:
        path = os.path.join(BASE, f)
        if not os.path.exists(path):
            with open(path, "w") as fh:
                fh.write("")
            print(f"  Created: {f}")

    print("\n✅ Project structure created successfully!")
    print("Next steps:")
    print("  1. pip install -r requirements.txt")
    print("  2. Copy .env.example to .env and fill in values")
    print("  3. docker-compose up -d  (starts Postgres + Redis)")
    print("  4. python -m app.main    (starts the API server)")

if __name__ == "__main__":
    main()
