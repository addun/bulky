const url = process.argv[2];

fetch(url)
  .then((response) => {
    process.exit(response.ok ? 0 : 1);
  })
  .catch(() => {
    process.exit(1);
  });
