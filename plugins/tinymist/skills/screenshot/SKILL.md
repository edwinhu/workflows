---
name: screenshot
description: Export Typst page as PNG and view it. Use when debugging layout issues, checking visual output, verifying formatting, or when the user wants to see what the document looks like.
version: 1.0.0
---

# Screenshot Typst Document

Use this skill to export a Typst document page as PNG and view it for visual inspection.

## When to use

- Debugging layout or formatting issues
- Verifying visual output after changes
- When user asks to “show”, “preview”, or “see” the document
- After fixing errors, to confirm the fix looks correct

## Auto-detect file

1. If a specific `.typ` file is mentioned, use it
2. Otherwise, search for `.typ` files in current directory using Glob
3. If multiple files found, use the most recently modified or ask user
4. If exactly one file found, use it automatically

## Export screenshot

Default: page 1 at 144 PPI

```bash
tinymist compile <input.typ> /tmp/typst-screenshot.png --pages 1 --ppi 144
```

Options:
- `--pages N` - Specific page number (default: 1)
- `--ppi N` - Resolution (default: 144, use 288 for 2x/retina)

## View the image

After successful export, use the Read tool to display the PNG:

```
Read /tmp/typst-screenshot.png
```

This allows visual inspection of the rendered output.

## Testing individual slides from presentations

When debugging a specific slide in a presentation that uses a theme (e.g., touying/university-theme), create a temporary test file to isolate the slide:

1. **Create test file in project directory** (required for theme imports):
   ```bash
   # Write to output/ or similar directory within the project
   cat > output/test-slide.typ << 'EOF'
   #import "../templates/theme.typ": *

   #show: university-theme.with(
     aspect-ratio: "16-9",
     config-info(title: [Test], author: [Test]),
   )

   #slide[
   // Paste slide content here
   ]
   EOF
   ```

2. **Compile with project root**:
   ```bash
   typst compile --root . output/test-slide.typ /tmp/test-slide.png --ppi 144
   ```

3. **View the result**:
   ```
   Read /tmp/test-slide.png
   ```

**Important**: The test file must be inside the project directory because Typst cannot access files outside its project root. Writing to `/tmp/` directly won't work if the file imports templates from the project.

## Error handling

If compilation fails:
- Report the error messages from tinymist
- Suggest using the check skill for detailed diagnostics
- Do NOT attempt to read a non-existent screenshot
