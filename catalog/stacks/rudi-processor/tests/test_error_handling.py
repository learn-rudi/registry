#!/usr/bin/env python3
"""
Test error handling and edge cases in RUDI processor
"""

import os
import sys
import tempfile
import unittest
from pathlib import Path

# Add parent to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from metadata_processor import MetadataProcessor

def test_error_handling():
    """Test various error conditions"""
    processor = MetadataProcessor()
    results = {
        'passed': [],
        'failed': [],
        'errors': []
    }

    print("=" * 60)
    print("RUDI PROCESSOR - ERROR HANDLING TESTS")
    print("=" * 60)

    # Test 1: Non-existent file
    print("\n1. Testing non-existent file...")
    try:
        result = processor.process_file("/fake/path/nonexistent.txt")
        if 'errors' in result.get('processing_status', {}):
            results['passed'].append("Non-existent file handled")
            print("   ✅ Handled gracefully")
        else:
            results['failed'].append("Non-existent file not handled")
            print("   ❌ Should have error status")
    except Exception as e:
        results['errors'].append(f"Non-existent file: {e}")
        print(f"   ❌ Exception: {e}")

    # Test 2: Empty file
    print("\n2. Testing empty file...")
    with tempfile.NamedTemporaryFile(suffix='.txt', delete=False) as tmp:
        tmp_path = tmp.name
    try:
        result = processor.process_file(tmp_path)
        if result.get('extracted_content', {}).get('full_text') == '':
            results['passed'].append("Empty file handled")
            print("   ✅ Empty file processed correctly")
        else:
            results['failed'].append("Empty file handling issue")
            print("   ❌ Empty file not handled properly")
    except Exception as e:
        results['errors'].append(f"Empty file: {e}")
        print(f"   ❌ Exception: {e}")
    finally:
        os.unlink(tmp_path)

    # Test 3: Corrupted file (binary data with text extension)
    print("\n3. Testing corrupted/binary file with text extension...")
    with tempfile.NamedTemporaryFile(suffix='.txt', delete=False) as tmp:
        tmp.write(b'\x00\x01\x02\x03\x04\x05')  # Binary data
        tmp_path = tmp.name
    try:
        result = processor.process_file(tmp_path)
        if 'errors' in result.get('processing_status', {}):
            results['passed'].append("Corrupted file handled")
            print("   ✅ Corrupted file handled gracefully")
        else:
            results['passed'].append("Binary file processed without crash")
            print("   ✅ Binary file processed without crash")
    except Exception as e:
        results['errors'].append(f"Corrupted file: {e}")
        print(f"   ❌ Exception: {e}")
    finally:
        os.unlink(tmp_path)

    # Test 4: File with no extension
    print("\n4. Testing file with no extension...")
    with tempfile.NamedTemporaryFile(delete=False) as tmp:
        tmp.write(b'Test content')
        tmp_path = tmp.name
    try:
        result = processor.process_file(tmp_path)
        if result.get('processing_status', {}).get('stage'):
            results['passed'].append("No extension file handled")
            print("   ✅ No extension file handled")
        else:
            results['failed'].append("No extension file issue")
            print("   ❌ No extension file not handled")
    except Exception as e:
        results['errors'].append(f"No extension: {e}")
        print(f"   ❌ Exception: {e}")
    finally:
        os.unlink(tmp_path)

    # Test 5: Very large filename
    print("\n5. Testing very long filename...")
    long_name = "a" * 200 + ".txt"
    with tempfile.TemporaryDirectory() as tmpdir:
        long_path = Path(tmpdir) / long_name
        long_path.write_text("Test content")
        try:
            result = processor.process_file(str(long_path))
            results['passed'].append("Long filename handled")
            print("   ✅ Long filename handled")
        except Exception as e:
            results['errors'].append(f"Long filename: {e}")
            print(f"   ❌ Exception: {e}")

    # Test 6: Special characters in filename
    print("\n6. Testing special characters in filename...")
    special_name = "test@#$%^&().txt"
    with tempfile.TemporaryDirectory() as tmpdir:
        special_path = Path(tmpdir) / special_name
        special_path.write_text("Test content")
        try:
            result = processor.process_file(str(special_path))
            results['passed'].append("Special characters handled")
            print("   ✅ Special characters handled")
        except Exception as e:
            results['errors'].append(f"Special characters: {e}")
            print(f"   ❌ Exception: {e}")

    # Test 7: Permission denied (simulate)
    print("\n7. Testing read permission issues...")
    with tempfile.NamedTemporaryFile(suffix='.txt', delete=False) as tmp:
        tmp.write(b'Test content')
        tmp_path = tmp.name
    try:
        os.chmod(tmp_path, 0o000)  # Remove all permissions
        result = processor.process_file(tmp_path)
        if 'errors' in result.get('processing_status', {}):
            results['passed'].append("Permission denied handled")
            print("   ✅ Permission error handled gracefully")
    except Exception as e:
        results['passed'].append("Permission error caught")
        print(f"   ✅ Permission error caught: {type(e).__name__}")
    finally:
        os.chmod(tmp_path, 0o644)  # Restore permissions
        os.unlink(tmp_path)

    # Test 8: Unicode in content
    print("\n8. Testing Unicode content...")
    with tempfile.NamedTemporaryFile(suffix='.txt', delete=False, mode='w', encoding='utf-8') as tmp:
        tmp.write("Test 你好 مرحبا 🚀 content")
        tmp_path = tmp.name
    try:
        result = processor.process_file(tmp_path)
        if result.get('extracted_content', {}).get('full_text'):
            results['passed'].append("Unicode handled")
            print("   ✅ Unicode content handled")
        else:
            results['failed'].append("Unicode issue")
            print("   ❌ Unicode not extracted properly")
    except Exception as e:
        results['errors'].append(f"Unicode: {e}")
        print(f"   ❌ Exception: {e}")
    finally:
        os.unlink(tmp_path)

    # Summary
    print("\n" + "=" * 60)
    print("TEST SUMMARY")
    print("=" * 60)
    print(f"✅ Passed: {len(results['passed'])}")
    for test in results['passed']:
        print(f"   • {test}")

    if results['failed']:
        print(f"\n❌ Failed: {len(results['failed'])}")
        for test in results['failed']:
            print(f"   • {test}")

    if results['errors']:
        print(f"\n⚠️ Errors: {len(results['errors'])}")
        for error in results['errors']:
            print(f"   • {error}")

    # Coverage estimate
    total_tests = len(results['passed']) + len(results['failed']) + len(results['errors'])
    success_rate = (len(results['passed']) / total_tests * 100) if total_tests > 0 else 0

    print(f"\n📊 Coverage: {success_rate:.1f}% success rate")
    print(f"   Total tests: {total_tests}")
    print(f"   Successful: {len(results['passed'])}")

    return results


class TestErrorHandling(unittest.TestCase):
    def test_all_error_handling_cases(self):
        results = test_error_handling()
        self.assertEqual(results["failed"], [])
        self.assertEqual(results["errors"], [])

if __name__ == "__main__":
    unittest.main()
