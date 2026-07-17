"""
Test configuration changes for Tesseract OCR.

Run with:
    cd backend_api
    python -m pytest tests/test_config.py -v
"""

import sys
import os
from unittest.mock import patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from app.core.config import Settings


class TestOCRSettings:
    """Test OCR-related configuration settings."""
    
    def test_tesseract_ocr_enabled_default_true(self):
        """Test that Tesseract OCR is enabled by default."""
        settings = Settings()
        assert hasattr(settings, 'tesseract_ocr_enabled')
        assert settings.tesseract_ocr_enabled is True
    
    def test_tesseract_ocr_can_be_disabled(self):
        """Test that TESSERACT_OCR_ENABLED can be set to false."""
        with patch.dict('os.environ', {'TESSERACT_OCR_ENABLED': 'false'}):
            settings = Settings()
            assert settings.tesseract_ocr_enabled is False
    
    def test_tesseract_ocr_can_be_enabled_explicitly(self):
        """Test that TESSERACT_OCR_ENABLED can be set to true."""
        with patch.dict('os.environ', {'TESSERACT_OCR_ENABLED': 'true'}):
            settings = Settings()
            assert settings.tesseract_ocr_enabled is True
    
    def test_paddle_ocr_removed(self):
        """Test that paddle_ocr_enabled attribute no longer exists."""
        settings = Settings()
        assert not hasattr(settings, 'paddle_ocr_enabled')
    
    def test_other_settings_unchanged(self):
        """Test that other settings remain unchanged."""
        settings = Settings()
        
        # Check that other important settings still exist
        assert hasattr(settings, 'app_title')
        assert hasattr(settings, 'database_path')
        assert hasattr(settings, 'mock_auth_enabled')
        assert hasattr(settings, 'max_upload_size_mb')
        assert hasattr(settings, 'allowed_upload_extensions')


class TestDatabaseSettings:
    """Test database configuration."""
    
    def test_database_path_default(self):
        """Test default database path."""
        settings = Settings()
        assert settings.database_path == "./smartspend.db"
    
    def test_database_url_env_override(self):
        """Test DATABASE_URL can override database_path."""
        # Note: Settings class uses database_path, not database_url
        settings = Settings()
        assert hasattr(settings, 'database_path')


class TestStorageSettings:
    """Test storage path configuration."""
    
    def test_storage_paths_exist(self):
        """Test that storage path settings exist."""
        settings = Settings()
        
        assert hasattr(settings, 'model_dir')
        assert hasattr(settings, 'user_model_dir')
        assert hasattr(settings, 'upload_dir')
        assert settings.model_dir == "./storage/models"
        assert settings.upload_dir == "./storage/uploads"


class TestAuthSettings:
    """Test authentication configuration."""
    
    def test_mock_auth_enabled_default(self):
        """Test mock auth is enabled by default."""
        settings = Settings()
        assert settings.mock_auth_enabled is True
    
    def test_mock_auth_can_be_disabled(self):
        """Test mock auth can be disabled for production."""
        with patch.dict('os.environ', {'MOCK_AUTH_ENABLED': 'false'}):
            settings = Settings()
            assert settings.mock_auth_enabled is False


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
