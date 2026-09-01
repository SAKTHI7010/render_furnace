import os
import shutil
from pathlib import Path

src = Path(".")
dst = Path("../smartmelt-studio")

if dst.exists():
    shutil.rmtree(dst)
dst.mkdir(parents=True)

# Directories to copy entirely
dirs_to_copy = ["backend", "frontend", "configs", "smartmelt", "examples", "docs"]

for d in dirs_to_copy:
    if (src / d).exists():
        shutil.copytree(src / d, dst / d)

# Specific directories and files
os.makedirs(dst / "gui" / "cache", exist_ok=True)
if (src / "gui" / "cache").exists():
    for f in (src / "gui" / "cache").iterdir():
        if f.is_file():
            shutil.copy2(f, dst / "gui" / "cache" / f.name)

os.makedirs(dst / "app" / "lib", exist_ok=True)
if (src / "app" / "lib").exists():
    for f in (src / "app" / "lib").iterdir():
        if f.is_file():
            shutil.copy2(f, dst / "app" / "lib" / f.name)

for f in ["background_jobs.py", "sim_worker.py", "__init__.py"]:
    if (src / "app" / f).exists():
        shutil.copy2(src / "app" / f, dst / "app" / f)

# Root files
files_to_copy = ["render.yaml", "README.md", "run_studio.bat", ".gitignore"]
for f in files_to_copy:
    if (src / f).exists():
        shutil.copy2(src / f, dst / f)

# Copy backend/requirements.txt to root
if (src / "backend" / "requirements.txt").exists():
    shutil.copy2(src / "backend" / "requirements.txt", dst / "requirements.txt")

print(f"Project successfully created at: {dst.resolve()}")
