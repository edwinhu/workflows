# Common Use Cases for Look At

## When to Use Look At vs Read Tool

### Use Look At When:
- ✅ File contains visual information (diagrams, charts, images)
- ✅ Need to extract specific information from a large document
- ✅ File format requires interpretation (PDF with complex layouts)
- ✅ Need description of visual content
- ✅ Want to save context tokens by only getting extracted data

### Use Read Tool When:
- ✅ Need exact file contents
- ✅ Working with source code or plain text
- ✅ Need to edit the file afterward
- ✅ File structure is important (YAML, JSON, code)
- ✅ Need to see everything, not just specific parts

## Document Analysis

### Research Papers
```bash
# Extract methodology section
python3 look_at.py --file paper.pdf \
    --goal "Extract the methodology section, including sample size and statistical methods"

# Extract findings
python3 look_at.py --file paper.pdf \
    --goal "List the main findings and conclusions"

# Extract citations for a specific topic
python3 look_at.py --file paper.pdf \
    --goal "List all citations related to machine learning methods"
```

### Financial Reports
```bash
# Extract key metrics
python3 look_at.py --file quarterly_report.pdf \
    --goal "Extract revenue, profit margin, and YoY growth percentages"

# Summarize risks
python3 look_at.py --file 10k_filing.pdf \
    --goal "Summarize the top 3 risk factors mentioned"

# Extract balance sheet data
python3 look_at.py --file financial_statements.pdf \
    --goal "Extract total assets, liabilities, and equity as JSON"
```

### Contracts and Legal Documents
```bash
# Extract key terms
python3 look_at.py --file contract.pdf \
    --goal "Extract payment terms, termination clause, and effective date"

# Identify obligations
python3 look_at.py --file agreement.pdf \
    --goal "List all obligations for Party A"

# Extract definitions
python3 look_at.py --file legal_doc.pdf \
    --goal "Extract all defined terms and their definitions"
```

## Image Analysis

### UI/UX Screenshots
```bash
# Inventory UI elements
python3 look_at.py --file app_screenshot.png \
    --goal "List all buttons, text fields, and navigation elements with their labels"

# Describe layout
python3 look_at.py --file wireframe.png \
    --goal "Describe the layout structure: header, sidebar, main content, footer"

# Identify accessibility issues
python3 look_at.py --file interface.png \
    --goal "Identify potential accessibility issues: contrast, button sizes, text legibility"
```

### Architecture Diagrams
```bash
# Explain system design
python3 look_at.py --file system_diagram.png \
    --goal "Explain the data flow between components and their relationships"

# List components
python3 look_at.py --file architecture.png \
    --goal "List all components/services shown and their responsibilities"

# Identify bottlenecks
python3 look_at.py --file performance_diagram.png \
    --goal "Identify potential bottlenecks or single points of failure"
```

### Charts and Graphs
```bash
# Extract data points
python3 look_at.py --file line_chart.png \
    --goal "Extract the data points for each line series as JSON"

# Describe trends
python3 look_at.py --file sales_chart.png \
    --goal "Describe the main trends and any notable patterns or anomalies"

# Extract legend
python3 look_at.py --file complex_chart.png \
    --goal "List what each color/line represents according to the legend"
```

## Data Extraction

### Tables
```bash
# Full table extraction
python3 look_at.py --file data_table.pdf \
    --goal "Extract the entire table as JSON array with all columns preserved"

# Filtered extraction
python3 look_at.py --file large_table.pdf \
    --goal "Extract only rows where Status = 'Active' as CSV"

# Summary statistics
python3 look_at.py --file spreadsheet.png \
    --goal "Calculate and report: sum, average, min, max for the 'Amount' column"
```

### Forms
```bash
# Extract filled values
python3 look_at.py --file filled_form.pdf \
    --goal "Extract all filled-in values with their corresponding field labels"

# Identify missing fields
python3 look_at.py --file incomplete_form.pdf \
    --goal "List all empty/unfilled fields"

# Convert to structured data
python3 look_at.py --file application_form.pdf \
    --goal "Extract as JSON: {name, email, phone, address, date_submitted}"
```

## Code and Technical Documentation

### API Documentation Screenshots
```bash
# Extract endpoint details
python3 look_at.py --file api_docs.png \
    --goal "Extract all API endpoints with their methods, paths, and descriptions"

# Extract request/response examples
python3 look_at.py --file api_example.png \
    --goal "Extract the request and response JSON examples shown"
```

### Whiteboards and Sketches
```bash
# Transcribe whiteboard session
python3 look_at.py --file whiteboard.jpg \
    --goal "Transcribe all text and describe any diagrams or sketches"

# Extract action items
python3 look_at.py --file meeting_notes.jpg \
    --goal "Extract all action items with assigned owners if visible"
```

### Database Schemas
```bash
# Extract table definitions
python3 look_at.py --file db_schema.png \
    --goal "List all tables with their columns, types, and relationships"

# Identify relationships
python3 look_at.py --file erd_diagram.png \
    --goal "Describe all foreign key relationships and their cardinality"
```

## Media Analysis

### Video Frames
```bash
# Analyze key frame
python3 look_at.py --file video_frame.jpg \
    --goal "Describe what's happening in this frame: people, actions, objects"

# Extract visible text
python3 look_at.py --file presentation_slide.mp4 \
    --goal "Extract all text visible on the slide"
```

### Presentations
```bash
# Extract slide content
python3 look_at.py --file slide_deck.pdf \
    --goal "Extract title and main points from slides 5-10"

# Create outline
python3 look_at.py --file presentation.pdf \
    --goal "Create an outline of the entire presentation with section headings"
```

## Advanced Patterns

### Comparative Analysis
```bash
# Compare two diagrams
python3 look_at.py --file version1.png \
    --goal "List all components and connections"

python3 look_at.py --file version2.png \
    --goal "List all components and connections"

# Then use Claude to compare the extracted information
```

### Multi-step Extraction
```bash
# Step 1: Identify sections
python3 look_at.py --file document.pdf \
    --goal "List all section headings with page numbers"

# Step 2: Extract specific section
python3 look_at.py --file document.pdf \
    --goal "Extract only the 'Results' section on pages 12-15"
```

### Validation
```bash
# Verify data quality
python3 look_at.py --file data_report.pdf \
    --goal "Check if all required fields are present: date, amount, signature"

# Cross-reference
python3 look_at.py --file invoice.pdf \
    --goal "Extract invoice number and total amount for verification"
```

## Anti-Patterns (Don't Do This)

### ❌ Too Vague
```bash
# Bad: Too general
python3 look_at.py --file doc.pdf --goal "Tell me about this document"

# Good: Specific request
python3 look_at.py --file doc.pdf --goal "Extract the author, date, and main conclusion"
```

### ❌ Asking for Everything
```bash
# Bad: Requesting full content
python3 look_at.py --file book.pdf --goal "Extract all text from this book"

# Good: Extract what you need
python3 look_at.py --file book.pdf --goal "Extract the table of contents"
```

### ❌ Using for Plain Text
```bash
# Bad: Using look_at for source code
python3 look_at.py --file script.py --goal "Show me the code"

# Good: Use Read tool instead
cat script.py
```

### ❌ Relative Paths
```bash
# Bad: Relative path
python3 look_at.py --file ../docs/report.pdf --goal "Extract title"

# Good: Absolute path
python3 look_at.py --file /home/user/docs/report.pdf --goal "Extract title"
```

## Cost Optimization Tips

1. **Be Specific:** Narrow goals = fewer output tokens = lower cost
2. **Batch Similar Requests:** Process multiple files in sequence
3. **Use Flash Lite:** Default model is optimal for most use cases
4. **Cache Insights:** Save extracted data to avoid re-processing
5. **Preprocess Large Files:** Split or compress before analysis

## Integration with Workflows

### Data Science Workflow
```bash
# In exploration phase, analyze data documentation
python3 look_at.py --file data_dictionary.pdf \
    --goal "Extract all column names, types, and descriptions as JSON"
```

### Development Workflow
```bash
# Analyze design mockups
python3 look_at.py --file mockup.png \
    --goal "List all UI components that need to be implemented"
```

### Writing Workflow
```bash
# Extract quotes from source material
python3 look_at.py --file research_paper.pdf \
    --goal "Extract all quotes related to climate change impacts"
```
