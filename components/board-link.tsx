// Every link on the board goes through parseHref: https opens with bb's
// browser preference, thread: and file: use bb navigation, and anything else
// stays plain text.
import { createContext, useContext, type ReactNode } from "react";
import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import { linkify, parseHref, type LinkTarget } from "@/lib/links";
import { Glyph, type GlyphName } from "./glyphs";

/** The board host, which holds file: links outside a thread's storage. */
export const BoardHostContext = createContext<string | null>(null);

function useTarget(href: string | null): LinkTarget {
  const hostId = useContext(BoardHostContext);
  return href === null || href === "" ? { kind: "invalid" } : parseHref(href, hostId);
}

const GLYPH: Partial<Record<LinkTarget["kind"], GlyphName>> = {
  url: "external",
  thread: "thread",
  file: "file",
};

/** Opens a parsed link target; returns false when there is nothing to open. */
export function useOpenLink(): (target: LinkTarget) => boolean {
  const navigate = useBbNavigate();
  return (target) => {
    switch (target.kind) {
      case "url":
        if (!navigate.openUrl(target.href)) window.open(target.href, "_blank", "noopener,noreferrer");
        return true;
      case "thread":
        navigate.toThread(target.threadId);
        return true;
      case "file":
        return navigate.experimental_openFilePreview({ target: target.file, location: null });
      default:
        return false;
    }
  };
}

/**
 * `children` linked to `href`, or plain when the href is empty or not an
 * allowed form. `icon` adds a small glyph naming the kind of link.
 */
export function BoardLink({
  href,
  children,
  icon = false,
  className,
}: {
  href: string | null;
  children: ReactNode;
  icon?: boolean;
  className?: string;
}) {
  const target = useTarget(href);
  const open = useOpenLink();
  const navigate = useBbNavigate();
  const glyph = icon ? GLYPH[target.kind] : undefined;
  if (target.kind === "url") {
    return (
      <a
        className={className}
        href={target.href}
        target="_blank"
        rel="noreferrer noopener"
        onClick={(event) => {
          // bb opens it with the user's browser preference; otherwise the anchor does.
          if (navigate.openUrl(target.href)) event.preventDefault();
        }}
      >
        {glyph ? <Glyph name={glyph} /> : null}
        {children}
      </a>
    );
  }
  if (target.kind === "thread" || target.kind === "file") {
    return (
      <button
        type="button"
        className={className ? `lb-linkish ${className}` : "lb-linkish"}
        data-link-kind={target.kind}
        onClick={() => open(target)}
      >
        {glyph ? <Glyph name={glyph} /> : null}
        {children}
      </button>
    );
  }
  const title = target.kind === "repo" ? `${target.project}/${target.path} (not linked yet)` : undefined;
  return className ? (
    <span className={`${className} lb-inert`} title={title}>
      {children}
    </span>
  ) : (
    <>{children}</>
  );
}

/** Plain text with its URLs and thread ids linked. */
export function LinkedText({ text }: { text: string }) {
  return (
    <>
      {linkify(text).map((part, index) =>
        part.href ? (
          <BoardLink key={index} href={part.href}>
            {part.text}
          </BoardLink>
        ) : (
          part.text
        ),
      )}
    </>
  );
}
