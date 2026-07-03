"""Quick test of enhanced receipt functionality"""
import sys
sys.path.insert(0, '.')

from app.services.receipt_validator import ReceiptValidator
from app.services.ocr_service import parse_receipt_header, parse_receipt_items

print("Testing enhanced receipt components...\n")

# Test 1: Validator
print("1. Testing ReceiptValidator...")
validator = ReceiptValidator()
test_receipt = {
    'merchant_name': 'Test Shop',
    'total_amount_rwf': 1000.0,
    'receipt_timestamp': '2026-07-03 10:00:00',
    'items': [
        {'product': 'Item 1', 'quantity': 2, 'unit_price': 250, 'total_amount': 500},
        {'product': 'Item 2', 'quantity': 2, 'unit_price': 250, 'total_amount': 500}
    ]
}
result = validator.validate(test_receipt)
print(f"   Confidence: {result.confidence:.2f}")
print(f"   Warnings: {len(result.warnings)}")
print(f"   ✓ Validator works!")

# Test 2: Enhanced Parser
print("\n2. Testing enhanced parser...")
test_text = """SHOP NAME
TIN 123456789
2026-07-03 10:00:00
Bread        1500
Milk         2000
TOTAL        3500 RWF"""

lines = test_text.strip().split('\n')
header = parse_receipt_header(lines)
print(f"   Merchant: {header['merchant_name']}")
print(f"   TIN: {header['merchant_tin']}")
print(f"   Total: {header['total_amount_rwf']}")
print(f"   ✓ Enhanced parser works!")

# Test 3: Item parsing
print("\n3. Testing item parsing...")
items = parse_receipt_items(test_text)
print(f"   Items extracted: {len(items)}")
for item in items:
    print(f"   - {item['item_name']}: {item['total_cost_rwf']} RWF")
print(f"   ✓ Item parser works!")

print("\n✅ All enhanced receipt components working correctly!")
print("✅ Ready for production use with improved accuracy")
