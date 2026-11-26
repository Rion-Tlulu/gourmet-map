/**
 * Tailwind CSS 設定（v3.4.17 スタンドアロンCLIで使用）
 *
 * - content のパスはリポジトリ直下で実行した場合の相対パス
 * - Bootstrap と併用するため、クラス名に「tw-」接頭辞を付けて競合を回避
 * - Bootstrap Reboot と重複しないよう Preflight を無効化
 * - 色はCSS変数を参照し、ダーク・ハイコントラストに自動追従
 *
 * 生成コマンド（README参照）：
 *   tailwindcss -c tailwind/tailwind.config.js -i tailwind/input.css -o css/app.css --minify
 */
module.exports = {
  prefix: "tw-",
  content: ["./index.html", "./js/**/*.js"],
  corePlugins: {
    preflight: false,
  },
  theme: {
    extend: {
      colors: {
        bg: "var(--gm-bg)",
        surface: "var(--gm-surface)",
        "surface-2": "var(--gm-surface-2)",
        ink: "var(--gm-text)",
        muted: "var(--gm-muted)",
        line: "var(--gm-border)",
        "line-strong": "var(--gm-border-strong)",
        primary: "var(--gm-primary)",
        "primary-hover": "var(--gm-primary-hover)",
        "on-primary": "var(--gm-on-primary)",
        accent: "var(--gm-accent)",
        "accent-ink": "var(--gm-accent-text)",
        success: "var(--gm-success)",
        "success-bg": "var(--gm-success-bg)",
        danger: "var(--gm-danger)",
        "danger-bg": "var(--gm-danger-bg)",
        warning: "var(--gm-warning)",
        "warning-bg": "var(--gm-warning-bg)",
        info: "var(--gm-info)",
        "info-bg": "var(--gm-info-bg)",
        heart: "var(--gm-heart)",
      },
      fontFamily: {
        sans: [
          "Inter",
          "Noto Sans JP",
          "Hiragino Sans",
          "Hiragino Kaku Gothic ProN",
          "Yu Gothic",
          "Meiryo",
          "sans-serif",
        ],
      },
      borderRadius: {
        card: "1.25rem",
      },
      boxShadow: {
        card: "var(--gm-shadow)",
      },
    },
  },
  plugins: [],
};
