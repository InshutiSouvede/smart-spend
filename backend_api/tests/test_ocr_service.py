"""
Unit tests for the SmartSpend Tesseract OCR service.

Run with:
    cd backend_api
    pip install -r requirements-test.txt
    python -m pytest tests/test_ocr_service.py -v
    
Tests the Tesseract OCR implementation including:
- OCR service initialization
- Image decoding and preprocessing
- Text extraction from images
- Error handling
- Receipt parsing functions
"""

import io
import sys
import os
from unittest.mock import Mock, patch, MagicMock
from pathlib import Path

# Allow running from the backend_api directory or project root
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
import numpy as np
from PIL import Image

from app.services.ocr_service import (
    OCRService,
    OCRResult,
    OCRLine,
    extract_text_from_receipt,
    parse_receipt_header,
    parse_receipt_items,
    validate_image_magic,
    compress_image_for_ocr,
    _parse_amount,
    _normalize_line,
    _is_metadata,
    _extract_amounts,
)


# ─── Test Fixtures ─────────────────────────────────────────────────────────────


@pytest.fixture
def sample_jpeg_bytes():
    """Create a minimal valid JPEG image in bytes."""
    img = Image.new('RGB', (100, 100), color='white')
    buf = io.BytesIO()
    img.save(buf, format='JPEG')
    return buf.getvalue()


@pytest.fixture
def sample_png_bytes():
    """Create a minimal valid PNG image in bytes."""
    img = Image.new('RGB', (100, 100), color='white')
    buf = io.BytesIO()
    img.save(buf, format='PNG')
    return buf.getvalue()


@pytest.fixture
def sample_receipt_text():
    """Sample OCR text output from a receipt."""
    return """SIMBA SUPERMARKET
Kigali, Rwanda
TIN: 123456789

Date: 2026-07-17 10:30:00

Bread          2000
Milk           1500
Eggs           3000

TOTAL          6500 RWF

Thank you for shopping!"""


@pytest.fixture
def mock_tesseract_data():
    """Mock Tesseract image_to_data output."""
    return {
        'text': ['SIMBA', 'SUPERMARKET', '', 'Bread', '2000', 'Milk', '1500', 'TOTAL', '6500', 'RWF'],
        'conf': [95, 93, -1, 88, 92, 90, 91, 96, 94, 89],
        'line_num': [1, 1, 2, 3, 3, 4, 4, 5, 5, 5],
        'left': [10, 100, 0, 10, 200, 10, 200, 10, 100, 150],
    }


# ─── OCRService Tests ──────────────────────────────────────────────────────────


class TestOCRServiceInitialization:
    """Test OCR service singleton and initialization."""
    
    def test_singleton_pattern(self):
        """Test that OCRService is a singleton."""
        service1 = OCRService()
        service2 = OCRService()
        assert service1 is service2, "OCRService should be a singleton"
    
    @patch('app.services.ocr_service.pytesseract')
    def test_ensure_engine_success(self, mock_pytesseract):
        """Test successful Tesseract initialization."""
        mock_pytesseract.get_tesseract_version.return_value = "5.0.0"
        
        service = OCRService()
        service._engine_ready = False  # Reset for test
        service._ensure_engine()
        
        assert service._engine_ready is True
        mock_pytesseract.get_tesseract_version.assert_called_once()
    
    @patch('app.services.ocr_service.pytesseract')
    def test_ensure_engine_import_error(self, mock_pytesseract):
        """Test error handling when pytesseract is not installed."""
        # Simulate ImportError
        with patch.dict('sys.modules', {'pytesseract': None}):
            service = OCRService()
            service._engine_ready = False
            
            with pytest.raises(RuntimeError, match="Tesseract OCR is not installed"):
                service._ensure_engine()
    
    @patch('app.services.ocr_service.pytesseract')
    def test_ensure_engine_binary_not_found(self, mock_pytesseract):
        """Test error handling when Tesseract binary is not available."""
        mock_pytesseract.get_tesseract_version.side_effect = Exception("Tesseract not found")
        
        service = OCRService()
        service._engine_ready = False
        
        with pytest.raises(RuntimeError, match="Tesseract OCR binary is not available"):
            service._ensure_engine()


class TestImageDecoding:
    """Test image decoding and preprocessing."""
    
    def test_decode_jpeg_image(self, sample_jpeg_bytes):
        """Test decoding a valid JPEG image."""
        service = OCRService()
        image = service._decode_image(sample_jpeg_bytes)
        
        assert isinstance(image, Image.Image)
        assert image.mode == 'L', "Image should be converted to grayscale"
    
    def test_decode_png_image(self, sample_png_bytes):
        """Test decoding a valid PNG image."""
        service = OCRService()
        image = service._decode_image(sample_png_bytes)
        
        assert isinstance(image, Image.Image)
        assert image.mode == 'L', "Image should be converted to grayscale"
    
    def test_decode_invalid_image(self):
        """Test error handling for invalid image data."""
        service = OCRService()
        invalid_data = b"This is not an image"
        
        with pytest.raises(ValueError, match="does not appear to be a valid image"):
            service._decode_image(invalid_data)
    
    def test_decode_empty_data(self):
        """Test error handling for empty data."""
        service = OCRService()
        
        with pytest.raises(ValueError):
            service._decode_image(b"")
    
    def test_image_contrast_enhancement(self, sample_jpeg_bytes):
        """Test that contrast enhancement is applied."""
        service = OCRService()
        image = service._decode_image(sample_jpeg_bytes)
        
        # Image should be preprocessed (grayscale + contrast)
        assert image.mode == 'L'


class TestOCRExtraction:
    """Test OCR text extraction."""
    
    @patch('app.services.ocr_service.pytesseract')
    def test_extract_text_success(self, mock_pytesseract, sample_jpeg_bytes, mock_tesseract_data):
        """Test successful text extraction from image."""
        mock_pytesseract.get_tesseract_version.return_value = "5.0.0"
        mock_pytesseract.image_to_data.return_value = mock_tesseract_data
        mock_pytesseract.Output = MagicMock()
        mock_pytesseract.Output.DICT = 'dict'
        
        service = OCRService()
        service._engine_ready = True
        result = service.extract(sample_jpeg_bytes)
        
        assert isinstance(result, OCRResult)
        assert result.text != ""
        assert len(result.lines) > 0
        assert 0.0 <= result.confidence <= 1.0
    
    @patch('app.services.ocr_service.pytesseract')
    def test_extract_text_empty_result(self, mock_pytesseract, sample_jpeg_bytes):
        """Test handling of empty OCR results."""
        mock_pytesseract.get_tesseract_version.return_value = "5.0.0"
        mock_pytesseract.image_to_data.return_value = {'text': [], 'conf': [], 'line_num': [], 'left': []}
        mock_pytesseract.Output = MagicMock()
        mock_pytesseract.Output.DICT = 'dict'
        
        service = OCRService()
        service._engine_ready = True
        result = service.extract(sample_jpeg_bytes)
        
        assert result.text == ""
        assert len(result.lines) == 0
        assert result.confidence == 0.0
        assert result.is_empty is True
    
    @patch('app.services.ocr_service.pytesseract')
    def test_extract_text_low_confidence_filtering(self, mock_pytesseract, sample_jpeg_bytes):
        """Test that low confidence results are filtered out."""
        mock_data = {
            'text': ['Good', 'Text', 'BadLowConf'],
            'conf': [90, 85, 10],  # Third item has very low confidence
            'line_num': [1, 1, 2],
            'left': [10, 50, 10],
        }
        mock_pytesseract.get_tesseract_version.return_value = "5.0.0"
        mock_pytesseract.image_to_data.return_value = mock_data
        mock_pytesseract.Output = MagicMock()
        mock_pytesseract.Output.DICT = 'dict'
        
        service = OCRService()
        service._engine_ready = True
        result = service.extract(sample_jpeg_bytes)
        
        # Low confidence text should be excluded
        assert 'BadLowConf' not in result.text
    
    @patch('app.services.ocr_service.pytesseract')
    def test_extract_text_exception_handling(self, mock_pytesseract, sample_jpeg_bytes):
        """Test error handling during OCR processing."""
        mock_pytesseract.get_tesseract_version.return_value = "5.0.0"
        mock_pytesseract.image_to_data.side_effect = Exception("OCR failed")
        mock_pytesseract.Output = MagicMock()
        mock_pytesseract.Output.DICT = 'dict'
        
        service = OCRService()
        service._engine_ready = True
        
        with pytest.raises(RuntimeError, match="OCR processing failed"):
            service.extract(sample_jpeg_bytes)


class TestOCRFromFile:
    """Test OCR extraction from file paths."""
    
    @patch('app.services.ocr_service.pytesseract')
    def test_extract_from_file_success(self, mock_pytesseract, tmp_path, sample_jpeg_bytes, mock_tesseract_data):
        """Test extracting text from a file path."""
        # Create temporary file
        test_file = tmp_path / "test_receipt.jpg"
        test_file.write_bytes(sample_jpeg_bytes)
        
        mock_pytesseract.get_tesseract_version.return_value = "5.0.0"
        mock_pytesseract.image_to_data.return_value = mock_tesseract_data
        mock_pytesseract.Output = MagicMock()
        mock_pytesseract.Output.DICT = 'dict'
        
        service = OCRService()
        service._engine_ready = True
        result = service.extract_from_file(str(test_file))
        
        assert isinstance(result, OCRResult)
        assert len(result.lines) > 0
    
    def test_extract_from_nonexistent_file(self):
        """Test error handling for nonexistent file."""
        service = OCRService()
        
        with pytest.raises(FileNotFoundError):
            service.extract_from_file("/nonexistent/file.jpg")


# ─── Backward Compatibility Tests ─────────────────────────────────────────────


class TestExtractTextFromReceipt:
    """Test the backward-compatible extract_text_from_receipt function."""
    
    @patch('app.services.ocr_service.settings')
    @patch('app.services.ocr_service.pytesseract')
    def test_extract_text_from_receipt_success(self, mock_pytesseract, mock_settings, tmp_path, sample_jpeg_bytes, mock_tesseract_data):
        """Test successful text extraction with backward-compatible function."""
        mock_settings.tesseract_ocr_enabled = True
        mock_pytesseract.get_tesseract_version.return_value = "5.0.0"
        mock_pytesseract.image_to_data.return_value = mock_tesseract_data
        mock_pytesseract.Output = MagicMock()
        mock_pytesseract.Output.DICT = 'dict'
        
        test_file = tmp_path / "receipt.jpg"
        test_file.write_bytes(sample_jpeg_bytes)
        
        text, mode = extract_text_from_receipt(str(test_file))
        
        assert isinstance(text, str)
        assert mode == "tesseract"
        assert text != ""
    
    @patch('app.services.ocr_service.settings')
    def test_extract_text_ocr_disabled(self, mock_settings, tmp_path, sample_jpeg_bytes):
        """Test error when OCR is disabled in settings."""
        mock_settings.tesseract_ocr_enabled = False
        
        test_file = tmp_path / "receipt.jpg"
        test_file.write_bytes(sample_jpeg_bytes)
        
        with pytest.raises(RuntimeError, match="OCR is disabled"):
            extract_text_from_receipt(str(test_file))


# ─── Image Validation Tests ────────────────────────────────────────────────────


class TestImageValidation:
    """Test image magic byte validation."""
    
    def test_validate_jpeg_image(self, sample_jpeg_bytes):
        """Test validation of JPEG image."""
        # Should not raise exception
        validate_image_magic(sample_jpeg_bytes, [".jpg", ".jpeg"])
    
    def test_validate_png_image(self, sample_png_bytes):
        """Test validation of PNG image."""
        # Should not raise exception
        validate_image_magic(sample_png_bytes, [".png"])
    
    def test_validate_wrong_extension(self, sample_jpeg_bytes):
        """Test rejection of image with wrong extension."""
        with pytest.raises(ValueError, match="not in the allowed list"):
            validate_image_magic(sample_jpeg_bytes, [".png"])
    
    def test_validate_invalid_magic_bytes(self):
        """Test rejection of invalid file data."""
        invalid_data = b"This is not an image file"
        
        with pytest.raises(ValueError, match="does not match any recognized image format"):
            validate_image_magic(invalid_data, [".jpg", ".png"])
    
    def test_validate_empty_data(self):
        """Test rejection of empty data."""
        with pytest.raises((ValueError, IndexError)):
            validate_image_magic(b"", [".jpg"])


class TestImageCompression:
    """Test image compression and resizing."""
    
    def test_compress_large_image(self, tmp_path):
        """Test compression of large images."""
        # Create a large image (> 4096px)
        large_img = Image.new('RGB', (5000, 5000), color='white')
        test_file = tmp_path / "large.jpg"
        large_img.save(test_file, format='JPEG')
        
        original_size = test_file.stat().st_size
        
        # Compress the image
        compress_image_for_ocr(str(test_file))
        
        # Check that image was resized
        resized_img = Image.open(test_file)
        assert max(resized_img.size) <= 4096
    
    def test_compress_small_image_unchanged(self, tmp_path, sample_jpeg_bytes):
        """Test that small images are not resized."""
        test_file = tmp_path / "small.jpg"
        test_file.write_bytes(sample_jpeg_bytes)
        
        original_img = Image.open(test_file)
        original_size = original_img.size
        
        compress_image_for_ocr(str(test_file))
        
        # Size should be unchanged
        resized_img = Image.open(test_file)
        assert resized_img.size == original_size
    
    def test_compress_pdf_skipped(self, tmp_path):
        """Test that PDF files are skipped."""
        test_file = tmp_path / "receipt.pdf"
        test_file.write_bytes(b"%PDF-1.4\nSome PDF content")
        
        # Should not raise exception, just skip
        compress_image_for_ocr(str(test_file))


# ─── Receipt Parsing Tests ─────────────────────────────────────────────────────


class TestParseReceiptHeader:
    """Test receipt header parsing."""
    
    def test_parse_merchant_name(self, sample_receipt_text):
        """Test extraction of merchant name."""
        lines = sample_receipt_text.split('\n')
        result = parse_receipt_header(lines)
        
        assert result['merchant_name'] is not None
        assert 'SIMBA' in result['merchant_name'].upper()
    
    def test_parse_total_amount(self, sample_receipt_text):
        """Test extraction of total amount."""
        lines = sample_receipt_text.split('\n')
        result = parse_receipt_header(lines)
        
        assert result['total_amount_rwf'] == 6500.0
    
    def test_parse_tin(self, sample_receipt_text):
        """Test extraction of TIN number."""
        lines = sample_receipt_text.split('\n')
        result = parse_receipt_header(lines)
        
        assert result['merchant_tin'] == '123456789'
    
    def test_parse_timestamp(self, sample_receipt_text):
        """Test extraction of timestamp."""
        lines = sample_receipt_text.split('\n')
        result = parse_receipt_header(lines)
        
        assert result['receipt_timestamp'] is not None
        assert '2026-07-17' in result['receipt_timestamp']
    
    def test_parse_empty_lines(self):
        """Test handling of empty input."""
        result = parse_receipt_header([])
        
        assert result['merchant_name'] is None
        assert result['total_amount_rwf'] is None
        assert result['receipt_timestamp'] is None


class TestParseReceiptItems:
    """Test receipt item parsing."""
    
    def test_parse_item_list(self, sample_receipt_text):
        """Test parsing of item list."""
        items = parse_receipt_items(sample_receipt_text)
        
        assert len(items) >= 3, "Should parse at least 3 items"
        
        # Check that items have required fields
        for item in items:
            assert 'item_name' in item
            assert 'total_cost_rwf' in item
    
    def test_parse_item_with_price(self):
        """Test parsing of item with price."""
        text = "Bread  2000\nMilk  1500"
        items = parse_receipt_items(text)
        
        assert len(items) >= 1
        item_names = [item['item_name'].lower() for item in items]
        assert any('bread' in name for name in item_names)
    
    def test_skip_total_lines(self):
        """Test that total lines are skipped."""
        text = "Item1  1000\nTOTAL  5000\nItem2  2000"
        items = parse_receipt_items(text)
        
        # Should not include TOTAL as an item
        item_names = [item['item_name'].upper() for item in items]
        assert 'TOTAL' not in item_names
    
    def test_parse_empty_text(self):
        """Test handling of empty text."""
        items = parse_receipt_items("")
        
        assert isinstance(items, list)
        # May have 0 items or fallback entries


class TestHelperFunctions:
    """Test helper parsing functions."""
    
    def test_parse_amount_valid(self):
        """Test parsing valid amounts."""
        assert _parse_amount("1000") == 1000.0
        assert _parse_amount("1,000") == 1000.0
        assert _parse_amount("1,234.56") == 1234.56
        assert _parse_amount("5000 RWF") == 5000.0
    
    def test_parse_amount_invalid(self):
        """Test parsing invalid amounts."""
        assert _parse_amount("invalid") is None
        assert _parse_amount("") is None
        assert _parse_amount("abc123") is None
    
    def test_parse_amount_negative(self):
        """Test that negative amounts return None."""
        assert _parse_amount("-100") is None
    
    def test_normalize_line(self):
        """Test line normalization."""
        assert _normalize_line("  Hello   World  ") == "Hello  World"
        assert _normalize_line("Tab\tText") == "Tab Text"
        assert _normalize_line("Multi    Space") == "Multi  Space"
    
    def test_is_metadata(self):
        """Test metadata detection."""
        assert _is_metadata("TOTAL: 5000") is True
        assert _is_metadata("Date: 2026-07-17") is True
        assert _is_metadata("TIN: 123456789") is True
        assert _is_metadata("Bread") is False
    
    def test_extract_amounts(self):
        """Test amount extraction from lines."""
        amounts = _extract_amounts("Item 1,000 and 500 RWF")
        assert 1000.0 in amounts
        assert 500.0 in amounts
        
        amounts = _extract_amounts("No amounts here")
        assert len(amounts) == 0


# ─── Integration Tests ─────────────────────────────────────────────────────────


class TestOCRIntegration:
    """Integration tests for the complete OCR flow."""
    
    @patch('app.services.ocr_service.pytesseract')
    def test_complete_ocr_flow(self, mock_pytesseract, tmp_path, sample_receipt_text):
        """Test complete OCR flow from file to parsed receipt."""
        # Create test image with receipt text
        img = Image.new('RGB', (800, 1000), color='white')
        test_file = tmp_path / "receipt.jpg"
        img.save(test_file, format='JPEG')
        
        # Mock Tesseract to return sample receipt text
        mock_data = {
            'text': sample_receipt_text.split(),
            'conf': [90] * len(sample_receipt_text.split()),
            'line_num': list(range(len(sample_receipt_text.split()))),
            'left': [10] * len(sample_receipt_text.split()),
        }
        mock_pytesseract.get_tesseract_version.return_value = "5.0.0"
        mock_pytesseract.image_to_data.return_value = mock_data
        mock_pytesseract.Output = MagicMock()
        mock_pytesseract.Output.DICT = 'dict'
        
        # Extract text
        service = OCRService()
        service._engine_ready = True
        result = service.extract_from_file(str(test_file))
        
        assert result.confidence > 0.5
        assert len(result.lines) > 0


# ─── Performance Tests ─────────────────────────────────────────────────────────


class TestPerformance:
    """Test performance-related functionality."""
    
    @patch('app.services.ocr_service.pytesseract')
    def test_singleton_performance(self, mock_pytesseract):
        """Test that singleton pattern avoids repeated initialization."""
        mock_pytesseract.get_tesseract_version.return_value = "5.0.0"
        
        service1 = OCRService()
        service1._ensure_engine()
        
        call_count_first = mock_pytesseract.get_tesseract_version.call_count
        
        # Create another instance
        service2 = OCRService()
        service2._ensure_engine()
        
        # Should not call initialization again
        assert mock_pytesseract.get_tesseract_version.call_count == call_count_first


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
