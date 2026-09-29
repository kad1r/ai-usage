# 2026-04-16 — UI Fixes & v1.2.0 Release

## Branch: `feat/multi-provider`  PR: #4

---

## Sorunlar ve Çözümler

### 1. Provider Settings Panel — `padding-bottom` Sorunu

**Sorun:** Sağdaki provider ayarları listesinin en altı kırpılıyordu (son satır görünmüyordu).

**Kök neden:** WebKit (Electron / Chromium) `display: flex; overflow-y: auto` kombinasyonunda `padding-bottom`'u yok sayıyor. Bu bilinen bir WebKit bug'ı.

**Başarısız denemeler:**
- CSS'de `#provider-settings-panel` veya `#provider-settings-list`'e `padding-bottom` yazmak
- JS'de `list.style.paddingBottom = '28px'` atamak
- `display: block` yapmak — başlık sol alta düştü (layout bozuldu)
- Spacer div eklemek

**Kesin çözüm (`styles.css`):**
```css
/* Panel = flex column (header üstte, liste altta stack için) */
#provider-settings-panel {
  position: absolute;
  inset: 0;
  background: var(--bg-primary);
  z-index: 100;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

/* Liste = block overflow (block modda padding-bottom çalışır) */
#provider-settings-list {
  flex: 1;
  overflow-y: auto;
  display: block;       /* ← kritik: flex değil block */
  padding-bottom: 28px;
}

/* gap yerine margin-bottom (flex değil block context içinde) */
#provider-settings-list .provider-setting-row {
  margin-bottom: 10px;
}
```

`renderer.js`'deki JS workaround'ları kaldırıldı (spacer div, paddingBottom ataması).

---

### 2. Provider Tab'larının Altında Scroll Bleed

**Sorun:** `#claude-usage` panelinde provider tab butonlarının altında kaydırma yapınca içerik tab'ların üstüne geçiyordu.

**Çözüm (`styles.css`):**
```css
#provider-tabs {
  display: flex;
  gap: 4px;
  padding: 8px 12px 8px;
  flex-wrap: wrap;
  border-bottom: 1px solid var(--border-main);  /* ← eklendi */
}
```

---

## Commit Geçmişi (bu session)

```
e9770f9  fix: add border-bottom to provider tabs to prevent scroll bleed
4ecdfff  feat: UI redesign, i18n, Claude Code credentials integration
4b4fddf  chore: bump version to 1.2.0
095368e  refactor: replace OAuth client-id flow with Claude Code credentials
```

---

## Release: v1.2.0

**Tag:** `v1.2.0`  
**Repo:** `kad1r/claude-usage-widget`  
**Asset:** `dist/Claude Usage Setup 1.2.0.exe`

**Release notları özeti:**
- UI redesign (tab sistemi, modern kart layout)
- i18n (TR/EN dil desteği)
- Claude Code credentials entegrasyonu (OAuth yerine)
- Chart iyileştirmeleri (doughnut, stacked bar, horizontal bar)
- Provider tab scroll bleed düzeltmesi
- Provider settings padding-bottom WebKit bug fix

---

## Dosya Değişiklikleri (feat/multi-provider boyunca)

| Dosya | Değişiklik |
|---|---|
| `main.js` | Claude Code credentials okuma, Gemini CLI scanner, multi-provider IPC |
| `preload.js` | Yeni IPC endpoint'leri expose etme |
| `renderer.js` | Provider tab switching, settings panel render, workaround temizliği |
| `index.html` | Tab butonları, detayli tab layout, i18n data-i18n attr |
| `package.json` | v1.2.0, asarUnpack, yeni bağımlılıklar |
| `styles.css` | UI redesign, provider panel, tab border, dark/light tema |
| `detailedStats.js` | Chart'lar, session tablosu, model-cost tablosu |
| `chart.js` | MiniChart canvas bileşeni |
| `gauge.js` | GaugeChart animasyonlu canvas bileşeni |
