import React from "react";

type Props = {
  rootClassName: string;
  rootStyle?: React.CSSProperties;
  sidebar: React.ReactNode;
  workspace: React.ReactNode;
  rightPanel: React.ReactNode;
};

export default function AppLayout({
  rootClassName,
  rootStyle,
  sidebar,
  workspace,
  rightPanel,
}: Props) {
  return (
    <div className={rootClassName} style={rootStyle}>
      <aside className="sidebar">{sidebar}</aside>
      <main className="main-area">
        <section className="workspace-layout">
          {workspace}
          {rightPanel}
        </section>
      </main>
    </div>
  );
}
