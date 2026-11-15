# 体操ステージ

円いステージ（半径 1.7 m）に乗った人のアバターに、体操風の動き（32拍・17.6秒の繰り返し）をさせる試作アイテム。ステージから出ると 0.2 秒で元の姿勢へ戻る。掴む・押すなどの操作はない。

- 状態：v2 アップロード済み（2026-11-15、item ID `01cd3b50-6b6d-407f-93f4-b06c62d1e640`、content hash `ec33ec241ea9`。v1 は 2026-11-13 の `301f60803096`、v2 は名前の変更だけ）。GitHub は toM7x7/taisoustage。**本番の部屋では未確認。**
- dev：`npm run dev`（5316、`.claude/launch.json` の `motion-stage`）→ `/?lab`
- 検証：`npm run verify`（テスト5件＋ビルド）、`node scripts/capture.mjs`（keys / enter / unison / routine / vr、画像は `output/capture/`）、`node scripts/thumb.mjs`

## 仕組み

- エリア判定は各クライアントが自分で行う。`useUsers` の `getLocalMovement` / `getMovement(id)` の位置をアイテムの座標へ直し、円の中かどうかを見る（[src/Item.tsx](src/Item.tsx)）。メッセージは送らない。
- 動きの時刻は壁時計（`Date.now()`）から決める。全員の画面で同じ拍になり、ステージ上の人はそろって動く。端末の時計がずれている人は、その分だけずれて見える。
- 姿勢は描画の直前に当て、描画の直後にホストの姿勢へ戻す（[src/pose-bridge.ts](src/pose-bridge.ts)）。骨格の探し方と全身の解き方は lab `xrift-avatar-pose-control` の写し（`src/pose-lib/`、`items/ki-charge-orb/src/pose-lib` から 2026-11-13 にコピー。lab 6584877 ＋頭の向きの未コミット分）。
- 体はステージの正面（アイテムの +Z、床の三角の印）へ 0.8 秒かけて向き直る。足は立っている位置に置くので、ポーズ中に歩くと姿勢のまま滑る。
- 動き：[src/motion/taiso.ts](src/motion/taiso.ts)（キー10個）と [src/motion/timeline.ts](src/motion/timeline.ts)（並び）。既存の体操の振り付けは写していない。lab の specs には未登録で、lab の品質検査（review / compat）は通していない。
- ステージの見た目は three.js の基本形状で組んだ仮のもの（Blender 正本なし）。当たり判定なし。

## 公式仕様の確認（2026-11-13）

`@xrift/world-components` 0.64.0（npm の最新と同じ。`references/xrift-world-components` は bb5bd1c のまま変更なし）。

このアイテムが頼っている前提：

| 前提 | SDK の約束か | 確認 |
|---|---|---|
| `getLocalMovement()` / `getMovement(id)` の `position` が足元のワールド位置 | 型はあるが基準点の明記なし | ラボのみ。本番で要確認 |
| 他人のアバターは `remote-player-<id>` の印の下、自分はどの印にも入らない骨格 | いいえ（ホストの慣習） | 本番で要確認。読めない骨格は当てずにコンソールへ理由を出す |
| 描画直前に骨を書き換えても、ホストが毎フレーム骨を上書きし直す | いいえ | 気功波・塩マシンガンで本番実績あり（掴んでいる人に対して） |
| `PlayerMovement.isInVR` で VR の人が分かる | 型にある | ラボのみ |

本番で確かめること：

- 掴んでいない人・何も操作していない人にも姿勢が当たるか（これまでのアイテムは持ち主だけに当てていた）
- 他人の画面でも同じ人が同じ拍で動いて見えるか
- 一人称（PC）での自分の体の見え方。カメラは動かしていない
- ステージ上で歩いたとき・ジャンプしたときの見え方
- VR の人：いまは当てない（`Item.tsx` の `POSE_VR = false`）
- スマホ
