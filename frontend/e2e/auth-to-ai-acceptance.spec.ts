import { expect, test } from "@playwright/test";

test("covers registration through AI suggestion acceptance", async ({ page }) => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `e2e-${suffix}@example.com`;
  const username = `e2e_${suffix.replace(/[^a-z0-9]/gi, "")}`;
  const password = "pw12345";
  const projectTitle = `E2E Bonus ${suffix}`;

  await page.goto("/login");

  await page.getByRole("button", { name: "Register" }).click();
  await page.getByPlaceholder("you@example.com").fill(email);
  await page.getByPlaceholder("username").fill(username);
  await page.getByPlaceholder("••••••••").fill(password);
  await page.getByRole("button", { name: "Create Account" }).click();

  await expect(page).toHaveURL(/\/projects$/);

  await page.getByRole("button", { name: /new project/i }).click();
  await page.getByPlaceholder("Project title").fill(projectTitle);
  await page.getByPlaceholder("Description (optional)").fill("Playwright bonus-path validation");
  await page.getByRole("button", { name: /^Create$/ }).click();

  await expect(page.getByText(projectTitle)).toBeVisible();
  await page.getByText(projectTitle).click();

  await expect(page).toHaveURL(/\/projects\/.+\/docs\/.+/);
  await expect(page.locator(".monaco-editor").first()).toBeVisible();
  await expect(page.locator(".view-lines")).toContainText("\\section{Introduction}");

  const disclosure = page.getByRole("button", { name: "I Understand" });
  if (await disclosure.isVisible()) {
    await disclosure.click();
  }

  await page.getByRole("button", { name: /ai edit/i }).click();
  const aiPrompt = page.getByPlaceholder("What to improve? (optional)");
  await aiPrompt.fill("Tighten the introduction");
  await aiPrompt.press("Enter");

  await expect(page.getByRole("button", { name: /accept all/i })).toBeVisible();
  await page.getByRole("button", { name: /accept all/i }).click();

  await expect(page.locator(".view-lines")).toContainText("Overview");
  await expect(page.locator(".view-lines")).not.toContainText("Introduction");
  await expect(page.getByText(/accepted/i)).toBeVisible();

  await page.reload();

  await expect(page.locator(".view-lines")).toContainText("Overview");
  await expect(page.locator(".view-lines")).not.toContainText("Introduction");
  await expect(page.getByText(/accepted/i)).toBeVisible();
});
