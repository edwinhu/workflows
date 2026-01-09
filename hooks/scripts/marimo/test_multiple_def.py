import marimo

__generated_with = "0.10.9"
app = marimo.App()


@app.cell
def _():
    # First definition of a
    a = 1
    return a,


@app.cell
def _():
    # Second definition of a - this should be an error
    a = 1
    return a,


if __name__ == "__main__":
    app.run()
