#!/usr/bin/env python3
“”“Gemini Web automation client using Chrome DevTools Protocol.

Automates Gemini Advanced for deep research and interacts with Paperpile extension.

Usage:
    # Ensure Chrome is running with debugging enabled:
    ./chrome_launcher.sh start

    # Run deep research:
    python gemini_client.py research “shareholder activism SEC disclosure”

    # Check status:
    python gemini_client.py status

Requirements:
    pip install playwright
    playwright install chromium
“””

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path

try:
    from playwright.sync_api import sync_playwright, Page, Browser
except ImportError:
    print(“Error: playwright not installed. Run: pip install playwright”)
    sys.exit(1)


class GeminiClient:
    “”“Client for automating Gemini Advanced via CDP.”“”

    GEMINI_URL = “https://gemini.google.com/app”
    CDP_URL = “http://localhost:9222”

    # Stealth JavaScript to hide automation
    STEALTH_JS = “””
    Object.defineProperty(navigator, ‘webdriver’, { get: () => undefined });
    window.chrome = { runtime: {} };
    const originalQuery = window.navigator.permissions.query;
    window.navigator.permissions.query = (parameters) => (
        parameters.name === ‘notifications’ ?
            Promise.resolve({ state: Notification.permission }) :
            originalQuery(parameters)
    );
    “””

    def __init__(self, cdp_url: str = CDP_URL):
        “”“Initialize client and connect to Chrome via CDP.”“”
        self.cdp_url = cdp_url
        self._playwright = None
        self._browser: Browser | None = None
        self._page: Page | None = None

    def connect(self) -> bool:
        “”“Connect to running Chrome instance.

        Returns:
            True if connected successfully, False otherwise.
        “””
        try:
            self._playwright = sync_playwright().start()
            self._browser = self._playwright.chromium.connect_over_cdp(self.cdp_url)

            # Use existing context (has user’s logins)
            if self._browser.contexts:
                context = self._browser.contexts[0]
                context.add_init_script(self.STEALTH_JS)
            else:
                print(“Warning: No existing browser context, creating new one”)
                context = self._browser.new_context()
                context.add_init_script(self.STEALTH_JS)

            return True
        except Exception as e:
            print(f”Error connecting to Chrome: {e}”)
            print(“Make sure Chrome is running: ./chrome_launcher.sh start”)
            return False

    def close(self):
        “”“Close the client connection.”“”
        if self._page:
            try:
                self._page.close()
            except Exception:
                pass
            self._page = None
        if self._playwright:
            self._playwright.stop()
            self._playwright = None

    def _get_or_create_gemini_page(self) -> Page | None:
        “”“Find existing Gemini tab or create new one.”“”
        context = self._browser.contexts[0]

        # Look for existing Gemini tab
        for page in context.pages:
            if “gemini.google.com” in page.url:
                print(f”Found existing Gemini tab: {page.url}”)
                return page

        # Create new tab
        print(“Opening new Gemini tab...”)
        page = context.new_page()
        page.goto(self.GEMINI_URL, wait_until=”domcontentloaded”, timeout=30000)
        page.wait_for_timeout(3000)  # Wait for JS to load
        return page

    def _check_logged_in(self, page: Page) -> bool:
        “”“Check if user is logged into Gemini.”“”
        # Look for the prompt input area (indicates logged in)
        try:
            prompt_area = page.query_selector(‘div[contenteditable=”true”]’)
            if prompt_area:
                return True
            # Also check for rich-textarea
            prompt_area = page.query_selector(“rich-textarea”)
            if prompt_area:
                return True
        except Exception:
            pass
        return False

    def _enter_prompt(self, page: Page, prompt: str) -> bool:
        “”“Enter a prompt into Gemini.

        Args:
            page: The Gemini page.
            prompt: The prompt text to enter.

        Returns:
            True if prompt was entered successfully.
        “””
        try:
            # Find the input area - Gemini uses contenteditable div or rich-textarea
            selectors = [
                ‘div[contenteditable=”true”]’,
                “rich-textarea”,
                ‘textarea[placeholder*=”Enter”]’,
                “.ql-editor”,
            ]

            input_el = None
            for selector in selectors:
                input_el = page.query_selector(selector)
                if input_el:
                    break

            if not input_el:
                print(“Error: Could not find prompt input area”)
                return False

            # Click to focus and type
            input_el.click()
            page.wait_for_timeout(500)

            # Type the prompt
            page.keyboard.type(prompt, delay=20)  # Slight delay to seem human
            page.wait_for_timeout(500)

            return True
        except Exception as e:
            print(f”Error entering prompt: {e}”)
            return False

    def _submit_prompt(self, page: Page) -> bool:
        “”“Submit the entered prompt.”“”
        try:
            # Look for send button
            send_selectors = [
                ‘button[aria-label*=”Send”]’,
                ‘button[aria-label*=”submit”]’,
                ‘button.send-button’,
                ‘mat-icon[data-mat-icon-name=”send”]’,
            ]

            for selector in send_selectors:
                btn = page.query_selector(selector)
                if btn:
                    btn.click()
                    return True

            # Fallback: press Enter
            page.keyboard.press(“Enter”)
            return True
        except Exception as e:
            print(f”Error submitting prompt: {e}”)
            return False

    def _wait_for_response(self, page: Page, timeout_seconds: int = 300) -> str | None:
        “”“Wait for Gemini to finish generating a response.

        Args:
            page: The Gemini page.
            timeout_seconds: Max time to wait (default 5 minutes for deep research).

        Returns:
            The response text, or None on timeout/error.
        “””
        print(f”Waiting for response (timeout: {timeout_seconds}s)...”)
        start_time = time.time()

        # Wait for the “stop” button to appear (indicates generation started)
        page.wait_for_timeout(2000)

        while time.time() - start_time < timeout_seconds:
            # Check if still generating (stop button visible)
            stop_btn = page.query_selector('button[aria-label*="Stop"]')
            if stop_btn and stop_btn.is_visible():
                elapsed = int(time.time() - start_time)
                print(f"  Generating... ({elapsed}s)", end="\r")
                page.wait_for_timeout(2000)
                continue

            # Generation complete - extract response
            page.wait_for_timeout(1000)
            return self._extract_response(page)

        print("\nTimeout waiting for response")
        return None

    def _extract_response(self, page: Page) -> str:
        “”“Extract the latest response from Gemini.”“”
        try:
            # Find response containers (model-response or message-content)
            response_selectors = [
                “model-response”,
                “.model-response-text”,
                “.message-content”,
                ‘div[data-message-author=”model”]’,
            ]

            for selector in response_selectors:
                responses = page.query_selector_all(selector)
                if responses:
                    # Get the last (most recent) response
                    last_response = responses[-1]
                    return last_response.inner_text()

            # Fallback: get all text from main content area
            main = page.query_selector(“main”)
            if main:
                return main.inner_text()

            return “”
        except Exception as e:
            print(f”Error extracting response: {e}”)
            return “”

    def _enable_deep_research_mode(self, page: Page) -> bool:
        “”“Enable Deep Research mode by clicking Tools > Deep Research.

        Returns:
            True if Deep Research mode was enabled successfully.
        “””
        try:
            # Check if Deep Research is already enabled (chip visible)
            dr_chip = page.query_selector(‘button:has-text(“Deep Research”)’)
            if dr_chip and “x” in (dr_chip.get_attribute(“aria-label”) or “”).lower():
                print(“Deep Research mode already enabled”)
                return True

            # Click Tools button
            tools_btn = page.query_selector(‘button:has-text(“Tools”)’)
            if not tools_btn:
                print(“Error: Could not find Tools button”)
                return False

            tools_btn.click()
            page.wait_for_timeout(500)

            # Click Deep Research in dropdown
            dr_option = page.query_selector(‘button:has-text(“Deep Research”)’)
            if not dr_option:
                print(“Error: Could not find Deep Research option”)
                return False

            dr_option.click()
            page.wait_for_timeout(500)

            print(“Deep Research mode enabled”)
            return True
        except Exception as e:
            print(f”Error enabling Deep Research mode: {e}”)
            return False

    def _click_start_research(self, page: Page) -> bool:
        “”“Click the ‘Start research’ button after research plan is shown.

        Returns:
            True if button was clicked successfully.
        “””
        try:
            # Wait for research plan to appear
            page.wait_for_timeout(2000)

            # Look for “Start research” button
            start_btn = page.query_selector(‘button:has-text(“Start research”)’)
            if not start_btn:
                print(“Warning: Could not find ‘Start research’ button”)
                return False

            start_btn.click()
            print(“Clicked ‘Start research’ button”)
            return True
        except Exception as e:
            print(f”Error clicking Start research: {e}”)
            return False

    def _wait_for_deep_research(self, page: Page, timeout_seconds: int = 300) -> str | None:
        “”“Wait for Deep Research to complete.

        Deep Research has multiple phases:
        1. Research plan shown (with Start research button)
        2. Researching websites
        3. Analyzing results
        4. Creating report

        Args:
            page: The Gemini page.
            timeout_seconds: Max time to wait.

        Returns:
            The research report text, or None on timeout/error.
        “””
        print(f”Waiting for Deep Research (timeout: {timeout_seconds}s)...”)
        start_time = time.time()

        # First, wait for and click “Start research” button
        for _ in range(10):
            if self._click_start_research(page):
                break
            page.wait_for_timeout(1000)
        else:
            print(“Warning: Proceeding without clicking Start research”)

        # Now wait for research to complete
        while time.time() - start_time < timeout_seconds:
            elapsed = int(time.time() - start_time)

            # Check for progress indicators
            progress_indicators = [
                'text="Researching"',
                'text="Analyzing"',
                'text="Creating"',
                ':has-text("Ready in")',
            ]

            is_processing = False
            for indicator in progress_indicators:
                if page.query_selector(indicator):
                    is_processing = True
                    break

            # Also check for stop button
            stop_btn = page.query_selector('button[aria-label*="Stop"]')
            if stop_btn and stop_btn.is_visible():
                is_processing = True

            if is_processing:
                print(f"  Deep Research in progress... ({elapsed}s)", end="\r")
                page.wait_for_timeout(3000)
                continue

            # Check if research is complete (look for final report)
            # Deep Research reports typically have specific structure
            page.wait_for_timeout(2000)
            return self._extract_response(page)

        print("\nTimeout waiting for Deep Research")
        return None

    def deep_research(self, topic: str, timeout_seconds: int = 300) -> dict:
        “”“Run a deep research query on Gemini.

        This uses Gemini’s Deep Research mode which:
        1. Creates a research plan
        2. Searches multiple sources
        3. Analyzes and synthesizes findings
        4. Generates a comprehensive report with citations

        Args:
            topic: The research topic/question.
            timeout_seconds: Max time to wait for response.

        Returns:
            Dict with ‘success’, ‘response’, and ‘url’ keys.
        “””
        result = {“success”: False, “response”: None, “url”: None}

        if not self.connect():
            return result

        try:
            page = self._get_or_create_gemini_page()
            if not page:
                print(“Error: Could not open Gemini page”)
                return result

            result[“url”] = page.url

            if not self._check_logged_in(page):
                print(“Error: Not logged into Gemini. Please log in manually first.”)
                print(“1. Run: ./chrome_launcher.sh start”)
                print(“2. Navigate to gemini.google.com in Chrome”)
                print(“3. Log in with your Google account”)
                return result

            # Enable Deep Research mode
            print(“Enabling Deep Research mode...”)
            if not self._enable_deep_research_mode(page):
                print(“Warning: Could not enable Deep Research mode, continuing anyway”)

            # Enter the research topic (no need for elaborate prompt - Deep Research handles it)
            print(f”Entering research topic: {topic[:50]}...”)
            if not self._enter_prompt(page, topic):
                return result

            print(“Submitting research query...”)
            if not self._submit_prompt(page):
                return result

            # Wait for Deep Research to complete
            response = self._wait_for_deep_research(page, timeout_seconds)
            if response:
                result[“success”] = True
                result[“response”] = response
                result[“url”] = page.url  # Update URL (may have changed to conversation ID)
                print(f”\nReceived Deep Research response ({len(response)} chars)”)

            return result

        except Exception as e:
            print(f”Error during deep research: {e}”)
            return result
        finally:
            self.close()

    def find_paperpile_buttons(self) -> list[dict]:
        “”“Find Paperpile extension buttons on the current page.

        Returns:
            List of button info dicts with ‘text’ and ‘selector’ keys.
        “””
        if not self.connect():
            return []

        try:
            page = self._get_or_create_gemini_page()
            if not page:
                return []

            buttons = []

            # Look for Paperpile extension elements
            paperpile_selectors = [
                ‘[class*=”paperpile”]’,
                ‘[id*=”paperpile”]’,
                ‘button[title*=”Paperpile”]’,
                ‘button[aria-label*=”Paperpile”]’,
                ‘a[href*=”paperpile”]’,
            ]

            for selector in paperpile_selectors:
                elements = page.query_selector_all(selector)
                for i, el in enumerate(elements):
                    try:
                        buttons.append(
                            {
                                “text”: el.inner_text()[:50] if el.inner_text() else “”,
                                “selector”: f”{selector}:nth-of-type({i+1})”,
                            }
                        )
                    except Exception:
                        pass

            return buttons
        finally:
            self.close()

    def status(self) -> dict:
        “”“Check status of Chrome and Gemini connection.

        Returns:
            Status dict with connection info.
        “””
        status = {
            “chrome_running”: False,
            “connected”: False,
            “gemini_tab”: False,
            “logged_in”: False,
        }

        # Check if Chrome is running
        try:
            import urllib.request

            urllib.request.urlopen(f”{self.cdp_url}/json/version”, timeout=2)
            status[“chrome_running”] = True
        except Exception:
            return status

        # Try to connect
        if not self.connect():
            return status
        status[“connected”] = True

        try:
            context = self._browser.contexts[0]
            for page in context.pages:
                if “gemini.google.com” in page.url:
                    status[“gemini_tab”] = True
                    status[“logged_in”] = self._check_logged_in(page)
                    break
        except Exception:
            pass
        finally:
            self.close()

        return status


def main():
    parser = argparse.ArgumentParser(description=”Gemini Web automation client”)
    subparsers = parser.add_subparsers(dest=”command”, help=”Commands”)

    # research command
    research_parser = subparsers.add_parser(“research”, help=”Run deep research”)
    research_parser.add_argument(“topic”, help=”Research topic”)
    research_parser.add_argument(
        “--timeout”, type=int, default=300, help=”Timeout in seconds (default: 300)”
    )
    research_parser.add_argument(
        “--output”, “-o”, help=”Output file for response (default: stdout)”
    )

    # status command
    subparsers.add_parser(“status”, help=”Check Chrome/Gemini status”)

    # paperpile command
    subparsers.add_parser(“paperpile”, help=”Find Paperpile buttons on page”)

    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        sys.exit(1)

    client = GeminiClient()

    if args.command == “status”:
        status = client.status()
        print(json.dumps(status, indent=2))
        sys.exit(0 if status[“chrome_running”] else 1)

    elif args.command == “research”:
        result = client.deep_research(args.topic, args.timeout)
        if result[“success”]:
            if args.output:
                Path(args.output).write_text(result[“response”])
                print(f”Response saved to {args.output}”)
            else:
                print(“\n” + “=” * 60)
                print(“RESEARCH RESPONSE”)
                print(“=” * 60)
                print(result[“response”])
            sys.exit(0)
        else:
            print(“Research failed”)
            sys.exit(1)

    elif args.command == “paperpile”:
        buttons = client.find_paperpile_buttons()
        if buttons:
            print(f”Found {len(buttons)} Paperpile elements:”)
            for btn in buttons:
                print(f”  - {btn[‘text’]} ({btn[‘selector’]})”)
        else:
            print(“No Paperpile elements found on page”)
        sys.exit(0 if buttons else 1)


if __name__ == “__main__”:
    main()
