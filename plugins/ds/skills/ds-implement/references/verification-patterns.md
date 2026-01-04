# Verification Patterns

Code patterns for output-first verification in data science workflows.

## Data Loading

```python
df = pd.read_csv(path)
print(f"Loaded: {df.shape}")
print(f"Columns: {df.columns.tolist()}")
print(f"Dtypes:\n{df.dtypes}")
df.head()
```

## Filtering

```python
before = len(df)
df = df[df['col'] > threshold]
after = len(df)
print(f"Filtered: {before} -> {after} ({100*(before-after)/before:.1f}% removed)")
```

## Merging

```python
left_size = len(df1)
right_size = len(df2)
merged = df1.merge(df2, on='key', how='left')
print(f"Merge: {left_size} x {right_size} -> {len(merged)}")
print(f"New nulls: {merged[df2.columns].isnull().sum().sum()}")
```

## Aggregation

```python
result = df.groupby('category').agg({'value': 'mean'})
print(f"Groups: {len(result)}")
print(f"Stats:\n{result.describe()}")
result.head(10)
```

## Model Training

```python
model.fit(X_train, y_train)
train_score = model.score(X_train, y_train)
val_score = model.score(X_val, y_val)
print(f"Train score: {train_score:.4f}")
print(f"Val score: {val_score:.4f}")
print(f"Gap: {train_score - val_score:.4f}")
```

## Quick Reference Table

| Operation | Required Output |
|-----------|-----------------|
| Load data | shape, dtypes, head() |
| Filter | shape before/after, % removed |
| Merge/Join | shape, null check, sample |
| Groupby | result shape, sample groups |
| Transform | before/after comparison, sample |
| Model fit | metrics, convergence info |
| Prediction | distribution, sample predictions |
