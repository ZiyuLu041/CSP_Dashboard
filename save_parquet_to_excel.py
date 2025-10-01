import pandas as pd

# Read the first 1000 rows from the parquet file
df = pd.read_parquet('/home/ziyulu1997/live_stream_visualization/parquet_data/crypto_statistics.parquet', engine='pyarrow')
df_subset = df.head(1000)

# Remove timezone information from datetime columns
for col in df_subset.select_dtypes(include=['datetime64[ns, UTC]', 'datetimetz']).columns:
    df_subset[col] = df_subset[col].dt.tz_localize(None)

# Save to Excel
output_file = '/home/ziyulu1997/live_stream_visualization/crypto_statistics_first_1000.xlsx'
df_subset.to_excel(output_file, index=False)

print(f"Successfully saved first 1000 rows to {output_file}")
print(f"Total rows saved: {len(df_subset)}")
print(f"\nColumns: {list(df_subset.columns)}")
