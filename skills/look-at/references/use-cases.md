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
look_at.sh --file paper.pdf \
    --goal "Extract the methodology section, including sample size and statistical methods"

# Extract findings
look_at.sh --file paper.pdf \
    --goal "List the main findings and conclusions"

# Extract citations for a specific topic
look_at.sh --file paper.pdf \
    --goal "List all citations related to machine learning methods"
```

### Financial Reports
```bash
# Extract key metrics
look_at.sh --file quarterly_report.pdf \
    --goal "Extract revenue, profit margin, and YoY growth percentages"

# Summarize risks
look_at.sh --file 10k_filing.pdf \
    --goal "Summarize the top 3 risk factors mentioned"

# Extract balance sheet data
look_at.sh --file financial_statements.pdf \
    --goal "Extract total assets, liabilities, and equity as JSON"
```

### Contracts and Legal Documents
```bash
# Extract key terms
look_at.sh --file contract.pdf \
    --goal "Extract payment terms, termination clause, and effective date"

# Identify obligations
look_at.sh --file agreement.pdf \
    --goal "List all obligations for Party A"

# Extract definitions
look_at.sh --file legal_doc.pdf \
    --goal "Extract all defined terms and their definitions"
```

## Image Analysis

### UI/UX Screenshots
```bash
# Inventory UI elements
look_at.sh --file app_screenshot.png \
    --goal "List all buttons, text fields, and navigation elements with their labels"

# Describe layout
look_at.sh --file wireframe.png \
    --goal "Describe the layout structure: header, sidebar, main content, footer"

# Identify accessibility issues
look_at.sh --file interface.png \
    --goal "Identify potential accessibility issues: contrast, button sizes, text legibility"
```

### Architecture Diagrams
```bash
# Explain system design
look_at.sh --file system_diagram.png \
    --goal "Explain the data flow between components and their relationships"

# List components
look_at.sh --file architecture.png \
    --goal "List all components/services shown and their responsibilities"

# Identify bottlenecks
look_at.sh --file performance_diagram.png \
    --goal "Identify potential bottlenecks or single points of failure"
```

### Charts and Graphs
```bash
# Extract data points
look_at.sh --file line_chart.png \
    --goal "Extract the data points for each line series as JSON"

# Describe trends
look_at.sh --file sales_chart.png \
    --goal "Describe the main trends and any notable patterns or anomalies"

# Extract legend
look_at.sh --file complex_chart.png \
    --goal "List what each color/line represents according to the legend"
```

## Data Extraction

### Tables
```bash
# Full table extraction
look_at.sh --file data_table.pdf \
    --goal "Extract the entire table as JSON array with all columns preserved"

# Filtered extraction
look_at.sh --file large_table.pdf \
    --goal "Extract only rows where Status = 'Active' as CSV"

# Summary statistics
look_at.sh --file spreadsheet.png \
    --goal "Calculate and report: sum, average, min, max for the 'Amount' column"
```

### Forms
```bash
# Extract filled values
look_at.sh --file filled_form.pdf \
    --goal "Extract all filled-in values with their corresponding field labels"

# Identify missing fields
look_at.sh --file incomplete_form.pdf \
    --goal "List all empty/unfilled fields"

# Convert to structured data
look_at.sh --file application_form.pdf \
    --goal "Extract as JSON: {name, email, phone, address, date_submitted}"
```

## Code and Technical Documentation

### API Documentation Screenshots
```bash
# Extract endpoint details
look_at.sh --file api_docs.png \
    --goal "Extract all API endpoints with their methods, paths, and descriptions"

# Extract request/response examples
look_at.sh --file api_example.png \
    --goal "Extract the request and response JSON examples shown"
```

### Whiteboards and Sketches
```bash
# Transcribe whiteboard session
look_at.sh --file whiteboard.jpg \
    --goal "Transcribe all text and describe any diagrams or sketches"

# Extract action items
look_at.sh --file meeting_notes.jpg \
    --goal "Extract all action items with assigned owners if visible"
```

### Database Schemas
```bash
# Extract table definitions
look_at.sh --file db_schema.png \
    --goal "List all tables with their columns, types, and relationships"

# Identify relationships
look_at.sh --file erd_diagram.png \
    --goal "Describe all foreign key relationships and their cardinality"
```

## Media Analysis

### Video Frames
```bash
# Analyze key frame
look_at.sh --file video_frame.jpg \
    --goal "Describe what's happening in this frame: people, actions, objects"

# Extract visible text
look_at.sh --file presentation_slide.mp4 \
    --goal "Extract all text visible on the slide"
```

### Presentations
```bash
# Extract slide content
look_at.sh --file slide_deck.pdf \
    --goal "Extract title and main points from slides 5-10"

# Create outline
look_at.sh --file presentation.pdf \
    --goal "Create an outline of the entire presentation with section headings"
```

## Advanced Patterns

### Comparative Analysis
```bash
# Compare two diagrams
look_at.sh --file version1.png \
    --goal "List all components and connections"

look_at.sh --file version2.png \
    --goal "List all components and connections"

# Then use Claude to compare the extracted information
```

### Multi-step Extraction
```bash
# Step 1: Identify sections
look_at.sh --file document.pdf \
    --goal "List all section headings with page numbers"

# Step 2: Extract specific section
look_at.sh --file document.pdf \
    --goal "Extract only the 'Results' section on pages 12-15"
```

### Validation
```bash
# Verify data quality
look_at.sh --file data_report.pdf \
    --goal "Check if all required fields are present: date, amount, signature"

# Cross-reference
look_at.sh --file invoice.pdf \
    --goal "Extract invoice number and total amount for verification"
```

## Anti-Patterns (Don't Do This)

### ❌ Too Vague
```bash
# Bad: Too general
look_at.sh --file doc.pdf --goal "Tell me about this document"

# Good: Specific request
look_at.sh --file doc.pdf --goal "Extract the author, date, and main conclusion"
```

### ❌ Asking for Everything
```bash
# Bad: Requesting full content
look_at.sh --file book.pdf --goal "Extract all text from this book"

# Good: Extract what you need
look_at.sh --file book.pdf --goal "Extract the table of contents"
```

### ❌ Using for Plain Text
```bash
# Bad: Using look_at for source code
look_at.sh --file script.py --goal "Show me the code"

# Good: Use Read tool instead
cat script.py
```

### ❌ Relative Paths
```bash
# Bad: Relative path
look_at.sh --file ../docs/report.pdf --goal "Extract title"

# Good: Absolute path
look_at.sh --file /home/user/docs/report.pdf --goal "Extract title"
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
look_at.sh --file data_dictionary.pdf \
    --goal "Extract all column names, types, and descriptions as JSON"
```

### Development Workflow
```bash
# Analyze design mockups
look_at.sh --file mockup.png \
    --goal "List all UI components that need to be implemented"
```

### Writing Workflow
```bash
# Extract quotes from source material
look_at.sh --file research_paper.pdf \
    --goal "Extract all quotes related to climate change impacts"
```
