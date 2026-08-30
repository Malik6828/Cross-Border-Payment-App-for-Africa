import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import QRScanner from './QRScanner';
import toast from 'react-hot-toast';

// Mock dependencies
vi.mock('react-hot-toast');
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key) => key,
  }),
}));

vi.mock('react-qr-reader', () => ({
  QrReader: ({ onResult, onError }) => (
    <div data-testid="qr-reader">
      <button
        data-testid="mock-scan-success"
        onClick={() => onResult({ text: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567890ABCDEFGHIJKLMNOP' })}
      >
        Scan Success
      </button>
      <button
        data-testid="mock-scan-invalid"
        onClick={() => onResult({ text: 'INVALID' })}
      >
        Scan Invalid
      </button>
      <button
        data-testid="mock-error-permission"
        onClick={() => onError({ name: 'NotAllowedError', message: 'Permission denied' })}
      >
        Permission Error
      </button>
      <button
        data-testid="mock-error-no-camera"
        onClick={() => onError({ name: 'NotFoundError', message: 'No camera' })}
      >
        No Camera Error
      </button>
    </div>
  ),
}));

describe('QRScanner', () => {
  const mockOnClose = vi.fn();
  const mockOnScan = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Mock navigator.mediaDevices
    global.navigator.mediaDevices = {
      enumerateDevices: vi.fn().mockResolvedValue([
        { kind: 'videoinput', label: 'Camera' }
      ]),
      getUserMedia: vi.fn().mockResolvedValue({
        getTracks: () => [{
          stop: vi.fn()
        }]
      })
    };

    // Mock navigator.permissions
    global.navigator.permissions = {
      query: vi.fn().mockResolvedValue({
        state: 'prompt',
        onchange: null
      })
    };
  });

  it('should not render when isOpen is false', () => {
    const { container } = render(
      <QRScanner isOpen={false} onClose={mockOnClose} onScan={mockOnScan} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('should render scanner when isOpen is true and camera available', async () => {
    render(<QRScanner isOpen={true} onClose={mockOnClose} onScan={mockOnScan} />);
    
    await waitFor(() => {
      expect(screen.getByTestId('qr-reader')).toBeInTheDocument();
    });
  });

  describe('Successful scan path', () => {
    it('should handle successful QR scan with valid Stellar address', async () => {
      render(<QRScanner isOpen={true} onClose={mockOnClose} onScan={mockOnScan} />);

      await waitFor(() => {
        expect(screen.getByTestId('qr-reader')).toBeInTheDocument();
      });

      const scanButton = screen.getByTestId('mock-scan-success');
      fireEvent.click(scanButton);

      await waitFor(() => {
        expect(mockOnScan).toHaveBeenCalledWith('GABCDEFGHIJKLMNOPQRSTUVWXYZ234567890ABCDEFGHIJKLMNOP');
        expect(mockOnClose).toHaveBeenCalled();
        expect(toast.success).toHaveBeenCalledWith('send.qr_scanned');
      });
    });

    it('should reject invalid QR code content', async () => {
      render(<QRScanner isOpen={true} onClose={mockOnClose} onScan={mockOnScan} />);

      await waitFor(() => {
        expect(screen.getByTestId('qr-reader')).toBeInTheDocument();
      });

      const scanButton = screen.getByTestId('mock-scan-invalid');
      fireEvent.click(scanButton);

      await waitFor(() => {
        expect(mockOnScan).not.toHaveBeenCalled();
        expect(toast.error).toHaveBeenCalledWith('send.qr_invalid');
      });
    });
  });

  describe('Camera permission denied', () => {
    it('should show fallback UI when permission is denied', async () => {
      global.navigator.permissions.query = vi.fn().mockResolvedValue({
        state: 'denied',
        onchange: null
      });

      render(<QRScanner isOpen={true} onClose={mockOnClose} onScan={mockOnScan} />);

      await waitFor(() => {
        expect(screen.getByText('send.camera_access_denied')).toBeInTheDocument();
        expect(screen.getByPlaceholderText('send.enter_stellar_address')).toBeInTheDocument();
      });
    });

    it('should show fallback when camera error occurs', async () => {
      render(<QRScanner isOpen={true} onClose={mockOnClose} onScan={mockOnScan} />);

      await waitFor(() => {
        expect(screen.getByTestId('qr-reader')).toBeInTheDocument();
      });

      const errorButton = screen.getByTestId('mock-error-permission');
      fireEvent.click(errorButton);

      await waitFor(() => {
        expect(screen.getByText('send.camera_access_denied')).toBeInTheDocument();
        expect(toast.error).toHaveBeenCalledWith('send.camera_permission_denied');
      });
    });

    it('should show "Request Camera Access" button when permission denied', async () => {
      global.navigator.permissions.query = vi.fn().mockResolvedValue({
        state: 'denied',
        onchange: null
      });

      render(<QRScanner isOpen={true} onClose={mockOnClose} onScan={mockOnScan} />);

      await waitFor(() => {
        expect(screen.getByText('send.request_camera_access')).toBeInTheDocument();
      });
    });
  });

  describe('No camera device', () => {
    it('should show fallback when no camera is detected', async () => {
      global.navigator.mediaDevices.enumerateDevices = vi.fn().mockResolvedValue([]);

      render(<QRScanner isOpen={true} onClose={mockOnClose} onScan={mockOnScan} />);

      await waitFor(() => {
        expect(screen.getByText('send.no_camera_detected')).toBeInTheDocument();
        expect(screen.getByPlaceholderText('send.enter_stellar_address')).toBeInTheDocument();
      });
    });

    it('should not show "Request Camera Access" button when no camera exists', async () => {
      global.navigator.mediaDevices.enumerateDevices = vi.fn().mockResolvedValue([]);

      render(<QRScanner isOpen={true} onClose={mockOnClose} onScan={mockOnScan} />);

      await waitFor(() => {
        expect(screen.getByText('send.no_camera_detected')).toBeInTheDocument();
      });

      expect(screen.queryByText('send.request_camera_access')).not.toBeInTheDocument();
    });
  });

  describe('Manual address entry', () => {
    beforeEach(async () => {
      global.navigator.permissions.query = vi.fn().mockResolvedValue({
        state: 'denied',
        onchange: null
      });
    });

    it('should accept valid Stellar address in manual input', async () => {
      const user = userEvent.setup();
      render(<QRScanner isOpen={true} onClose={mockOnClose} onScan={mockOnScan} />);

      await waitFor(() => {
        expect(screen.getByPlaceholderText('send.enter_stellar_address')).toBeInTheDocument();
      });

      const input = screen.getByPlaceholderText('send.enter_stellar_address');
      await user.type(input, 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567890ABCDEFGHIJKLMNOP');

      const submitButton = screen.getByText('common.continue');
      await user.click(submitButton);

      await waitFor(() => {
        expect(mockOnScan).toHaveBeenCalledWith('GABCDEFGHIJKLMNOPQRSTUVWXYZ234567890ABCDEFGHIJKLMNOP');
        expect(mockOnClose).toHaveBeenCalled();
        expect(toast.success).toHaveBeenCalledWith('send.address_entered');
      });
    });

    it('should validate address starts with G', async () => {
      const user = userEvent.setup();
      render(<QRScanner isOpen={true} onClose={mockOnClose} onScan={mockOnScan} />);

      await waitFor(() => {
        expect(screen.getByPlaceholderText('send.enter_stellar_address')).toBeInTheDocument();
      });

      const input = screen.getByPlaceholderText('send.enter_stellar_address');
      await user.type(input, 'XABCDEFGHIJKLMNOPQRSTUVWXYZ234567890ABCDEFGHIJKLMNOP');

      const submitButton = screen.getByText('common.continue');
      await user.click(submitButton);

      await waitFor(() => {
        expect(screen.getByText('Stellar address must start with G')).toBeInTheDocument();
        expect(mockOnScan).not.toHaveBeenCalled();
      });
    });

    it('should validate address length is 56 characters', async () => {
      const user = userEvent.setup();
      render(<QRScanner isOpen={true} onClose={mockOnClose} onScan={mockOnScan} />);

      await waitFor(() => {
        expect(screen.getByPlaceholderText('send.enter_stellar_address')).toBeInTheDocument();
      });

      const input = screen.getByPlaceholderText('send.enter_stellar_address');
      await user.type(input, 'GABCDEF');

      const submitButton = screen.getByText('common.continue');
      await user.click(submitButton);

      await waitFor(() => {
        expect(screen.getByText(/Address must be 56 characters/)).toBeInTheDocument();
        expect(mockOnScan).not.toHaveBeenCalled();
      });
    });

    it('should validate address contains only valid characters', async () => {
      const user = userEvent.setup();
      render(<QRScanner isOpen={true} onClose={mockOnClose} onScan={mockOnScan} />);

      await waitFor(() => {
        expect(screen.getByPlaceholderText('send.enter_stellar_address')).toBeInTheDocument();
      });

      const input = screen.getByPlaceholderText('send.enter_stellar_address');
      await user.type(input, 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567890ABCDEFGHIJKLMNO@');

      const submitButton = screen.getByText('common.continue');
      await user.click(submitButton);

      await waitFor(() => {
        expect(screen.getByText('Address contains invalid characters')).toBeInTheDocument();
        expect(mockOnScan).not.toHaveBeenCalled();
      });
    });

    it('should show character count while typing', async () => {
      const user = userEvent.setup();
      render(<QRScanner isOpen={true} onClose={mockOnClose} onScan={mockOnScan} />);

      await waitFor(() => {
        expect(screen.getByPlaceholderText('send.enter_stellar_address')).toBeInTheDocument();
      });

      const input = screen.getByPlaceholderText('send.enter_stellar_address');
      await user.type(input, 'GABCDEFGH');

      await waitFor(() => {
        expect(screen.getByText('9/56 characters')).toBeInTheDocument();
      });
    });

    it('should clear error when user types after validation error', async () => {
      const user = userEvent.setup();
      render(<QRScanner isOpen={true} onClose={mockOnClose} onScan={mockOnScan} />);

      await waitFor(() => {
        expect(screen.getByPlaceholderText('send.enter_stellar_address')).toBeInTheDocument();
      });

      const input = screen.getByPlaceholderText('send.enter_stellar_address');
      await user.type(input, 'SHORT');

      const submitButton = screen.getByText('common.continue');
      await user.click(submitButton);

      await waitFor(() => {
        expect(screen.getByText(/Address must be 56 characters/)).toBeInTheDocument();
      });

      await user.type(input, 'G');

      await waitFor(() => {
        expect(screen.queryByText(/Address must be 56 characters/)).not.toBeInTheDocument();
      });
    });
  });

  describe('Request camera permission', () => {
    it('should request camera permission and switch to scanner on grant', async () => {
      const user = userEvent.setup();
      global.navigator.permissions.query = vi.fn().mockResolvedValue({
        state: 'denied',
        onchange: null
      });

      render(<QRScanner isOpen={true} onClose={mockOnClose} onScan={mockOnScan} />);

      await waitFor(() => {
        expect(screen.getByText('send.request_camera_access')).toBeInTheDocument();
      });

      const requestButton = screen.getByText('send.request_camera_access');
      await user.click(requestButton);

      await waitFor(() => {
        expect(global.navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({ video: true });
        expect(toast.success).toHaveBeenCalledWith('send.camera_permission_granted');
      });
    });

    it('should handle permission request denial', async () => {
      const user = userEvent.setup();
      global.navigator.permissions.query = vi.fn().mockResolvedValue({
        state: 'denied',
        onchange: null
      });
      global.navigator.mediaDevices.getUserMedia = vi.fn().mockRejectedValue({
        name: 'NotAllowedError'
      });

      render(<QRScanner isOpen={true} onClose={mockOnClose} onScan={mockOnScan} />);

      await waitFor(() => {
        expect(screen.getByText('send.request_camera_access')).toBeInTheDocument();
      });

      const requestButton = screen.getByText('send.request_camera_access');
      await user.click(requestButton);

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith('send.camera_permission_denied_persistent');
      });
    });
  });

  describe('Close behavior', () => {
    it('should reset state when closing', async () => {
      const user = userEvent.setup();
      global.navigator.permissions.query = vi.fn().mockResolvedValue({
        state: 'denied',
        onchange: null
      });

      render(<QRScanner isOpen={true} onClose={mockOnClose} onScan={mockOnScan} />);

      await waitFor(() => {
        expect(screen.getByPlaceholderText('send.enter_stellar_address')).toBeInTheDocument();
      });

      const input = screen.getByPlaceholderText('send.enter_stellar_address');
      await user.type(input, 'GABCD');

      const closeButton = screen.getByRole('button', { name: '' }); // X button has no text
      await user.click(closeButton);

      expect(mockOnClose).toHaveBeenCalled();
    });
  });
});
