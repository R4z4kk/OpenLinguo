const HAN_RUN = /\p{Script=Han}[\p{Script=Han}·]*(?:\[[^\]]*\])?/gu;

/** A gloss with its Chinese words (`皓[hao4]`) in their own language, so a screen reader voices them in Chinese. */
export const GlossText = ({ text }: { readonly text: string }) => {
  const parts: (string | { readonly at: number; readonly word: string })[] = [];
  let end = 0;
  for (const { 0: word, index } of text.matchAll(HAN_RUN)) {
    parts.push(text.slice(end, index), { at: index, word });
    end = index + word.length;
  }
  parts.push(text.slice(end));
  return (
    <>
      {parts.map((part) =>
        typeof part === "string" ? (
          part
        ) : (
          <span key={part.at} lang="zh-Hans">
            {part.word}
          </span>
        ),
      )}
    </>
  );
};
