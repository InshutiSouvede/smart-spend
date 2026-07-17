"""
Simplified tests for OCR configuration changes.
These tests verify the Tesseract OCR configuration without requiring full dependencies.

Run with:
    .\.venv\Scripts\activate
    python tests/test_simple_config.py
"""

import sys
import os

# Simple test without pytest for verification
def test_tesseract_config():
    """Test that tesseract_ocr_enabled setting exists."""
    # Add parent directory to path
    sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
    
    try:
        from app.core.config import Settings
        
        settings = Settings()
        
        # Test 1: tesseract_ocr_enabled exists
        assert hasattr(settings, 'tesseract_ocr_enabled'), "Missing tesseract_ocr_enabled attribute"
        print("✓ Test 1 passed: tesseract_ocr_enabled attribute exists")
        
        # Test 2: Default value is True
        assert settings.tesseract_ocr_enabled is True, "Default value should be True"
        print("✓ Test 2 passed: tesseract_ocr_enabled defaults to True")
        
        # Test 3: paddle_ocr_enabled should NOT exist
        assert not hasattr(settings, 'paddle_ocr_enabled'), "paddle_ocr_enabled should be removed"
        print("✓ Test 3 passed: paddle_ocr_enabled removed successfully")
        
        # Test 4: Other settings unchanged
        assert hasattr(settings, 'app_title'), "app_title missing"
        assert hasattr(settings, 'database_path'), "database_path missing"
        assert hasattr(settings, 'model_dir'), "model_dir missing"
        print("✓ Test 4 passed: Other settings intact")
        
        print("\n✅ All configuration tests passed!")
        return True
        
    except Exception as e:
        print(f"\n❌ Test failed: {e}")
        import traceback
        traceback.print_exc()
        return False


def test_ocr_service_imports():
    """Test that OCR service can be imported."""
    sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
    
    try:
        # Test basic imports (without actually initializing Tesseract)
        from app.services.ocr_service import (
            OCRService,
            OCRResult,
            OCRLine,
            _parse_amount,
            _normalize_line,
        )
        
        print("✓ Test 5 passed: OCR service imports successfully")
        
        # Test helper functions
        assert _parse_amount("1000") == 1000.0
        assert _parse_amount("1,234.56") == 1234.56
        assert _parse_amount("invalid") is None
        print("✓ Test 6 passed: _parse_amount function works correctly")
        
        assert _normalize_line("  Hello   World  ") == "Hello  World"
        print("✓ Test 7 passed: _normalize_line function works correctly")
        
        # Test OCRResult dataclass
        result = OCRResult(text="Test", lines=[], confidence=0.9)
        assert result.text == "Test"
        assert result.confidence == 0.9
        assert result.is_empty is False
        print("✓ Test 8 passed: OCRResult dataclass works correctly")
        
        empty_result = OCRResult(text="", lines=[], confidence=0.0)
        assert empty_result.is_empty is True
        print("✓ Test 9 passed: OCRResult.is_empty property works correctly")
        
        print("\n✅ All OCR service tests passed!")
        return True
        
    except Exception as e:
        print(f"\n❌ Test failed: {e}")
        import traceback
        traceback.print_exc()
        return False


if __name__ == "__main__":
    print("=" * 60)
    print("SmartSpend Backend - Tesseract OCR Configuration Tests")
    print("=" * 60)
    print()
    
    # Run tests
    config_passed = test_tesseract_config()
    print()
    ocr_passed = test_ocr_service_imports()
    
    print()
    print("=" * 60)
    if config_passed and ocr_passed:
        print("✅ ALL TESTS PASSED")
        print("=" * 60)
        sys.exit(0)
    else:
        print("❌ SOME TESTS FAILED")
        print("=" * 60)
        sys.exit(1)
