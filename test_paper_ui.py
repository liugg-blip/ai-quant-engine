from pathlib import Path

from playwright.sync_api import sync_playwright


URL = "http://127.0.0.1:8780/QUANT_ENGINE_v10.html"
SHOT = Path(__file__).with_name("paper_ui_verified.png")


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1600, "height": 1000})
    console_errors = []
    page_errors = []
    page.on("console", lambda msg: console_errors.append(msg.text) if msg.type == "error" else None)
    page.on("pageerror", lambda exc: page_errors.append(str(exc)))
    page.goto(URL, wait_until="networkidle", timeout=120_000)

    page.locator("#btnPaper").click()
    page.locator("#mask7.on").wait_for(timeout=30_000)
    page.locator("#srv7").filter(has_text="后端").wait_for(timeout=30_000)
    assert "模拟盘 · 非真实资金" in page.locator("#modal7 header").inner_text()

    if page.locator("#paperAccount option").count() == 0:
        page.locator("#paperNewName").fill("复合信号模拟账户")
        page.locator("#paperNewCash").fill("100000")
        page.locator("#paperCreateSave").click()
        page.locator("#paperContent").wait_for(state="visible", timeout=30_000)

    assert page.locator("#pkAsset").inner_text().startswith("¥")
    assert page.locator("#paperModeTag").inner_text() == "安全确认模式"
    page.locator("#paperWatchInput").fill("510300, 510500, 159915, 588000")
    page.locator("#paperWatchSave").click()
    page.locator("#paperWatchTags .secChip").first.wait_for(timeout=30_000)
    assert page.locator("#paperWatchTags .secChip").count() == 4

    assert page.locator("#prComm").input_value() == "2.50"
    assert page.locator("#prSlip").input_value() == "5.00"
    assert page.locator("#prStamp").input_value() == "5.00"
    page.locator("#paperGenerate").click()
    page.locator("#paperGenerate:not([disabled])").wait_for(timeout=180_000)
    state = page.locator("#paperSignalState").inner_text()
    assert "失败" not in state and "个标的" in state
    assert page.locator("#paperSignals tbody tr").count() == 4

    page.locator('[data-sim-sec="wealth"]').click()
    page.locator("#simWealth.on").wait_for(timeout=30_000)
    page.locator("#wealthTable tbody tr").first.wait_for(timeout=180_000)
    assert "复合信号模拟账户" in page.locator("#wealthTable").inner_text()
    canvas = page.locator("#wealthChart canvas")
    canvas.wait_for(timeout=30_000)
    box = canvas.bounding_box()
    assert box and box["width"] > 400 and box["height"] > 180

    page.screenshot(path=str(SHOT), full_page=True)
    assert not page_errors, page_errors
    assert not [x for x in console_errors if "favicon" not in x.lower()], console_errors
    print(
        {
            "account": page.locator("#wealthTable tbody tr").count(),
            "signals": 4,
            "wealth_canvas": [round(box["width"]), round(box["height"])],
            "screenshot": str(SHOT),
            "page_errors": page_errors,
            "console_errors": console_errors,
        }
    )
    browser.close()
