/** Saves `text` as a file named `name`. */
export const download = (text: string, name: string, type = "application/json"): void => {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  // Some browsers read the URL after `click` returns.
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 60_000);
};
