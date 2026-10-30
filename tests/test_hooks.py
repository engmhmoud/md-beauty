import re

from md_beauty.hooks import callout_kind, fix_lists, render_extras


def test_three_space_list_content_moves_to_four_spaces():
    md = "1. Question\n\n   Answer\n2. Next"
    assert fix_lists(md) == "1. Question\n\n    Answer\n2. Next"


def test_two_space_nested_list_becomes_four_spaces():
    assert fix_lists("- a\n  - b\n    - c") == "- a\n    - b\n        - c"


def test_list_after_paragraph_gets_a_blank_line():
    assert fix_lists("**Must know:**\n- one") == "**Must know:**\n\n- one"


def test_fenced_code_inside_list_is_shifted_with_its_item():
    md = "1. Run:\n   ```bash\n   echo hi\n   ```"
    assert fix_lists(md) == "1. Run:\n    ```bash\n    echo hi\n    ```"


def test_top_level_code_block_is_untouched():
    md = "```\n- not a list\n   indented\n```"
    assert fix_lists(md) == md


def test_callout_kind_from_label():
    assert callout_kind("Builds on:") == "info"
    assert callout_kind("Tip:") == "tip"
    assert callout_kind("Common trap:") == "warning"


def test_github_alert_becomes_callout_and_marker_is_removed():
    html = render_extras("<blockquote>\n<p>[!WARNING]\nCareful.</p>\n</blockquote>")
    assert '<blockquote class="callout callout-warning">' in html
    assert "[!WARNING]" not in html


def test_tag_in_code_becomes_pill():
    html = render_extras("<h2>Title <code>[MUST]</code></h2>")
    assert '<span class="tag tag-must">MUST</span>' in html


def test_details_wrapped_in_paragraphs_is_unwrapped():
    html = render_extras("<p><details><summary>Answer</summary></p>\n<p>x</p>\n<p></details></p>")
    assert not re.search(r"<p>\s*<details", html)
    assert "<p></details></p>" not in html


def test_bullet_list_then_numbered_list_stay_separate():
    out = fix_lists("- a\n- b\n\n1. one\n2. two")
    assert "<!-- -->" in out
    assert out.index("- b") < out.index("<!-- -->") < out.index("1. one")


def test_quotes_separated_by_a_blank_line_stay_separate():
    out = fix_lists("> **Tip:** one\n\n> **Trap:** two")
    assert out.split("\n").count("<!-- -->") == 1


def test_list_item_after_code_fence_gets_a_blank_line():
    md = "1. Run:\n   ```\n   x\n   ```\n2. Next"
    assert fix_lists(md).endswith("    ```\n\n2. Next")


def test_details_under_question_starts_its_own_block():
    md = "1. **Q?**\n   <details><summary>Answer</summary>"
    assert fix_lists(md) == "1. **Q?**\n\n    <details><summary>Answer</summary>"
